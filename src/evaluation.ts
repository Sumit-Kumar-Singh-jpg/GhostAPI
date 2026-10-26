import { createHash, randomUUID } from 'node:crypto';
import { applyPatch } from './domain/policy.js';
import { plannerContext, type PlannerObservation } from './integrations/planner.js';
import type { Evidence, Patch, Run, Workflow } from './domain/types.js';

export type ComparisonBranch = {
  arm: 'with_rea' | 'without_rea';
  status: 'passed' | 'failed' | 'abstained' | 'error';
  context_sha256: string;
  patch?: Patch;
  workflow?: Workflow;
  runs: Run[];
  error?: string;
  reserved_usd: number;
  planner_receipt?: { run_id: string; steps: number | null; provider: 'tinyfish' };
};
export type Evaluation = {
  id: string;
  created_at: string;
  completed_at: string;
  status: 'completed' | 'inconclusive';
  planner: 'rules fallback' | 'openai' | 'tinyfish-ai';
  model: string | null;
  executor: 'local-http' | 'tinyfish-browser';
  release: string;
  contribution:
    | 'rules_only'
    | 'rea_assisted'
    | 'without_rea_sufficient'
    | 'evidence_not_helpful'
    | 'recovery_failed'
    | 'inconclusive';
  summary: string;
  branches: ComparisonBranch[];
  active_version_unchanged: boolean;
  reserved_usd: number;
};
export function comparisonConclusion(
  branches: ComparisonBranch[],
  planner: Evaluation['planner'],
): Pick<Evaluation, 'status' | 'contribution' | 'summary'> {
  if (branches.length !== 2 || branches.some((b) => b.status === 'error'))
    return {
      status: 'inconclusive',
      contribution: 'inconclusive',
      summary: 'Comparison could not complete under equal configured limits.',
    };
  const withRea = branches.find((b) => b.arm === 'with_rea')!,
    without = branches.find((b) => b.arm === 'without_rea')!;
  if (planner === 'rules fallback')
    return {
      status: 'completed',
      contribution: 'rules_only',
      summary: `Rules comparison: with REA ${withRea.status}; without REA ${without.status}. This tests deterministic behavior and does not establish LLM contribution.`,
    };
  if (withRea.status === 'passed' && without.status === 'passed')
    return {
      status: 'completed',
      contribution: 'without_rea_sufficient',
      summary: 'Both candidates passed. Recovery without REA was sufficient in this comparison.',
    };
  if (
    withRea.status === 'passed' &&
    without.status !== 'passed' &&
    Boolean(withRea.patch?.rea_evidence_ids.length)
  )
    return {
      status: 'completed',
      contribution: 'rea_assisted',
      summary:
        'Only the REA-assisted candidate passed this paired test. This is not a general accuracy claim.',
    };
  if (withRea.status !== 'passed' && without.status === 'passed')
    return {
      status: 'completed',
      contribution: 'evidence_not_helpful',
      summary:
        'The candidate without REA passed while the assisted candidate did not. REA did not improve this outcome.',
    };
  if (withRea.status === 'passed')
    return {
      status: 'completed',
      contribution: 'inconclusive',
      summary:
        'A candidate passed but did not cite the provided REA evidence. Contribution is unestablished.',
    };
  return {
    status: 'completed',
    contribution: 'recovery_failed',
    summary: 'Neither candidate passed verification. Recovery was not demonstrated.',
  };
}
export async function compareRepair(options: {
  id?: string;
  base: Workflow;
  evidence: Evidence;
  version: number;
  observations: PlannerObservation[];
  planner: Evaluation['planner'];
  executor: Evaluation['executor'];
  model: string | null;
  reserved?: () => number;
  receipt?: () => ComparisonBranch['planner_receipt'];
  plan: (evidence: Evidence | undefined) => Promise<Patch>;
  replay: (
    workflow: Workflow,
    arm: ComparisonBranch['arm'],
  ) => Promise<{ runs: Run[]; reserved_usd: number; error?: string }>;
}): Promise<Evaluation> {
  const branches: ComparisonBranch[] = [];
  const evaluation: Evaluation = {
    id: options.id ?? randomUUID(),
    created_at: new Date().toISOString(),
    completed_at: '',
    status: 'inconclusive',
    planner: options.planner,
    model: options.model,
    executor: options.executor,
    release: options.evidence.release,
    contribution: 'inconclusive',
    summary: 'Comparison in progress',
    branches,
    active_version_unchanged: true,
    reserved_usd: 0,
  };
  for (const arm of ['with_rea', 'without_rea'] as const) {
    const evidence = arm === 'with_rea' ? structuredClone(options.evidence) : undefined;
    const branch: ComparisonBranch = {
      arm,
      status: 'error',
      context_sha256: createHash('sha256')
        .update(
          JSON.stringify(
            plannerContext(options.base, evidence, options.version, options.observations),
          ),
        )
        .digest('hex'),
      runs: [],
      reserved_usd: 0,
    };
    branches.push(branch);
    try {
      let raw: Patch;
      try {
        raw = await options.plan(evidence);
        branch.planner_receipt = options.receipt?.();
      } catch (error) {
        branch.status = /unknown:|refus|abstain/i.test(error instanceof Error ? error.message : '')
          ? 'abstained'
          : 'error';
        branch.error = error instanceof Error ? error.message : 'Planner failed';
        continue;
      }
      try {
        const { patch, workflow } = applyPatch(
          options.base,
          raw,
          evidence ? [evidence.id] : [],
          options.version,
        );
        branch.patch = patch;
        branch.workflow = workflow;
      } catch {
        branch.status = 'failed';
        branch.error = 'Generated candidate violated the fixed patch policy.';
        continue;
      }
      try {
        const replay = await options.replay(branch.workflow!, arm);
        branch.runs = replay.runs;
        branch.reserved_usd = replay.reserved_usd;
        branch.error = replay.error;
        branch.status = replay.error
          ? 'error'
          : branch.runs.length === 3 &&
              branch.runs.every((r) => r.result && r.checks.every((c) => c.pass))
            ? 'passed'
            : 'failed';
      } catch (error) {
        branch.status = 'error';
        branch.error = error instanceof Error ? error.message : 'Replay failed';
      }
    } finally {
      branch.reserved_usd = options.reserved?.() ?? branch.reserved_usd;
    }
  }
  Object.assign(evaluation, comparisonConclusion(branches, options.planner));
  evaluation.completed_at = new Date().toISOString();
  evaluation.reserved_usd = branches.reduce((sum, b) => sum + b.reserved_usd, 0);
  return evaluation;
}
