import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Store } from './store.js';
import { baseline, parseInput, applyPatch } from './domain/policy.js';
import { assertCycle, newCycle, reserve } from './domain/budget.js';
import { validateObservation } from './domain/validator.js';
import { executeLocal } from './integrations/local.js';
import { inspectWithRea, localHar, sanitizeHar } from './integrations/evidence.js';
import { llmPlan, rulesPlan } from './integrations/planner.js';
import { acceptanceInputs, oracleCheck } from './oracle.js';
import type { Candidate, Cycle, Evidence, Input, Release, Run, Workflow } from './domain/types.js';

export function safeError(error: unknown): string {
  let message = error instanceof Error ? error.message : 'Operation failed';
  for (const key of ['OPENAI_API_KEY', 'TINYFISH_API_KEY']) {
    const secret = process.env[key];
    if (secret) message = message.replaceAll(secret, '[redacted]');
  }
  return message.slice(0, 800);
}

export class GhostService {
  busy = false;
  // Injectable executor is a test seam. API clients cannot supply code/executors.
  execute = executeLocal;
  constructor(
    readonly store: Store,
    readonly portalOrigin: string,
  ) {}
  get state() {
    return this.store.state;
  }
  get active(): Workflow {
    return this.state.workflows.find((w) => w.workflow_version === this.state.active_version)!;
  }
  async exclusive<T>(fn: () => Promise<T>): Promise<T> {
    if (this.busy) throw new Error('busy: another operation is running');
    this.busy = true;
    try {
      return await fn();
    } catch (err) {
      const message = safeError(err);
      this.store.event('error', 'Operation stopped', message);
      if (/budget_exhausted|stale_release/.test(message)) {
        if (this.state.cycle) this.state.cycle.status = 'expired';
        this.state.health = 'Degraded';
        delete this.state.published;
      } else if (/blocked:/i.test(message)) {
        this.state.health = 'Blocked';
        delete this.state.published;
      }
      await this.store.save();
      throw new Error(message);
    } finally {
      this.busy = false;
    }
  }
  private startCycle() {
    if (this.state.cycle?.status === 'active') this.state.cycle.status = 'expired';
    this.state.cycle = newCycle(
      this.state.release,
      this.state.generation,
      Number(process.env.CYCLE_BUDGET_USD ?? 1),
    );
    this.store.event(
      'info',
      'Evidence cycle started',
      'Local HTTP replay. No TinyFish call or charge is represented.',
      this.state.cycle.id,
    );
    return this.state.cycle;
  }
  private cycle(): Cycle {
    const cycle = this.state.cycle;
    if (!cycle) throw new Error('Start a baseline or quote run to open an evidence cycle.');
    assertCycle(cycle, this.state.release);
    return cycle;
  }
  private assertCurrent(cycle: Cycle) {
    assertCycle(cycle, this.state.release);
    if (cycle.id !== this.state.cycle?.id || cycle.generation !== this.state.generation)
      throw new Error('stale_release: superseded cycle or workflow generation');
  }
  async run(workflow: Workflow, input: Input, cycle: Cycle): Promise<Run> {
    parseInput(input);
    for (let attempt = 0; attempt < 2; attempt++) {
      this.assertCurrent(cycle);
      const timeout = reserve(cycle, this.state.release, 0);
      await this.store.save();
      const run: Run = {
        id: `attempt-${randomUUID()}`,
        executor: 'local-http',
        status: 'FAILED',
        started_at: new Date().toISOString(),
        completed_at: '',
        input,
        workflow_version: workflow.workflow_version,
        release: this.state.release,
        checks: [],
      };
      try {
        const execution = await this.execute(workflow, input, timeout);
        run.id = execution.id;
        this.assertCurrent(cycle);
        run.observation = execution.observation;
        run.status = 'COMPLETED';
        const validation = validateObservation(
          execution.observation,
          workflow,
          input,
          this.state.release,
          [execution.id],
          Date.parse(cycle.started_at),
        );
        run.checks = validation.checks;
        run.result = validation.result;
      } catch (err) {
        run.error = safeError(err);
      }
      run.completed_at = new Date().toISOString();
      this.state.runs.push(run);
      this.store.event(
        run.result ? 'success' : 'warning',
        run.result ? 'Replay validated' : 'Replay withheld',
        run.error ??
          run.checks
            .filter((c) => !c.pass)
            .map((c) =>
              c.id === 'SCHEMA'
                ? 'SCHEMA: required quotation fields are missing or changed'
                : `${c.id}: ${c.detail}`,
            )
            .join('; '),
        run.id,
      );
      await this.store.save();
      if (run.error?.startsWith('transient:') && attempt === 0) {
        this.store.event(
          'warning',
          'Transient retry',
          'One bounded retry; no drift inferred from outage.',
        );
        continue;
      }
      return run;
    }
    throw new Error('Unexpected retry state');
  }
  async baseline() {
    if (this.state.release !== 'r1')
      throw new Error('Baseline requires site r1. Switch the operator release first.');
    const cycle = this.startCycle();
    const workflow = this.state.workflows.find((w) => w.workflow_version === 1)!;
    const run = await this.run(workflow, { sku: 'MOTOR-01', quantity: 1 }, cycle);
    this.assertCurrent(cycle);
    if (!run.result) {
      this.state.health = 'Degraded';
      delete this.state.published;
    } else {
      if (this.state.active_version !== 1) this.state.activation_history.push(1);
      this.state.active_version = 1;
      this.state.generation++;
      cycle.generation = this.state.generation;
      this.state.health = 'Healthy';
      this.state.published = run.result;
      this.store.event('success', 'Baseline pinned', 'wf1 / r1 · Inclusive price contract saved.');
    }
    await this.store.save();
    return run;
  }
  async switchRelease(release: Release) {
    if (!['r1', 'r2'].includes(release)) throw new Error('invalid release');
    if (release === this.state.release) return;
    this.state.release = release;
    this.state.generation++;
    this.state.health = 'Suspected';
    delete this.state.published;
    for (const c of this.state.candidates)
      if (['Draft', 'Verifying'].includes(c.state)) {
        c.state = 'Quarantined';
        c.checks.push({
          id: 'RELEASE_CURRENT',
          pass: false,
          detail: 'Operator changed release; candidate proof invalidated',
        });
      }
    // The deliberate break belongs to the same demo cycle. Its earlier r1 run
    // remains baseline history, never current-release candidate evidence.
    if (this.state.cycle?.status === 'active') {
      this.state.cycle.release = release;
      this.state.cycle.generation = this.state.generation;
    }
    this.store.event(
      'warning',
      'Operator changed site release',
      `Now ${release}. Verified publication cleared; current-release checks required.`,
    );
    await this.store.save();
  }
  async quote(value: unknown) {
    const input = parseInput(value);
    let cycle = this.state.cycle;
    if (!cycle || cycle.status !== 'active' || Date.now() >= cycle.deadline)
      cycle = this.startCycle();
    const run = await this.run(this.active, input, cycle);
    this.assertCurrent(cycle);
    if (run.result) {
      this.state.health = 'Healthy';
      this.state.published = run.result;
    } else {
      this.state.health = run.error?.startsWith('blocked:')
        ? 'Blocked'
        : run.error?.startsWith('transient:')
          ? 'Degraded'
          : 'Suspected';
      delete this.state.published;
    }
    await this.store.save();
    return run;
  }
  async inspect(raw?: unknown) {
    const cycle = this.cycle();
    this.state.health = 'Inspecting';
    delete this.state.published;
    const timeout = reserve(cycle, this.state.release, 0, false);
    await this.store.save();
    const input = { sku: 'MOTOR-01', quantity: 1 };
    const capture = raw ?? (await localHar(this.portalOrigin, input, timeout));
    const sanitized = sanitizeHar(
      capture,
      this.portalOrigin,
      this.state.release,
      Date.parse(cycle.started_at),
      raw ? 'operator-har' : 'local-http',
    );
    let evidence: Evidence = sanitized.evidence;
    try {
      evidence = await inspectWithRea(
        sanitized.text,
        evidence,
        this.store.dir,
        Math.min(timeout, cycle.deadline - Date.now()),
      );
      this.store.event(
        'success',
        'REA inspected supplied HAR',
        'Pinned REA CLI parsed a sanitized response-body capture. This is not passive CDP capture.',
        evidence.id,
      );
    } catch (err) {
      this.store.event(
        'warning',
        'REA inspection unavailable',
        `${safeError(err)}. Retaining local capture evidence; no REA-assisted claim.`,
      );
    }
    this.assertCurrent(cycle);
    this.state.evidence.push(evidence);
    this.store.event(
      'info',
      raw ? 'Operator HAR imported' : 'Local HTTP evidence captured',
      `Observed ${evidence.fields.length} allowed fields from ${evidence.paths.join(', ')}. ${raw ? 'Operator-provided browser export.' : 'Generated from actual local HTTP response, not a browser export.'}`,
      evidence.id,
    );
    await this.store.save();
    return evidence;
  }
  async propose(useLlm = false, withoutEvidence = false) {
    const cycle = this.cycle();
    const evidence = withoutEvidence
      ? undefined
      : this.state.evidence.findLast(
          (e) =>
            e.release === this.state.release &&
            Date.parse(e.created_at) >= Date.parse(cycle.started_at),
        );
    if (!evidence) {
      this.state.health = 'Escalated';
      await this.store.save();
      throw new Error('unknown: no current evidence; planner abstained');
    }
    const nextVersion = Math.max(...this.state.workflows.map((w) => w.workflow_version)) + 1;
    let raw: unknown;
    if (useLlm) {
      const cost = Number(process.env.PLANNER_MAX_COST_USD);
      if (!Number.isFinite(cost) || cost <= 0)
        throw new Error('Configure a verified PLANNER_MAX_COST_USD before an LLM call.');
      const timeout = reserve(cycle, this.state.release, cost, false);
      await this.store.save();
      raw = await llmPlan(this.active, evidence, nextVersion, Math.min(timeout, 30000));
    } else raw = rulesPlan(this.active, evidence, nextVersion);
    this.assertCurrent(cycle);
    const { patch, workflow } = applyPatch(
      this.active,
      raw,
      this.state.evidence.map((e) => e.id),
      nextVersion,
    );
    const candidate: Candidate = {
      id: randomUUID(),
      state: 'Draft',
      workflow,
      patch,
      planner: useLlm ? 'openai' : 'rules fallback',
      evidence_ids: [evidence.id],
      tests: [],
      checks: [
        {
          id: 'PATCH_ALLOWLIST',
          pass: true,
          detail: 'Only catalog IDs and approved route changed; mandatory policy unchanged',
        },
      ],
      created_at: new Date().toISOString(),
    };
    this.state.workflows.push(workflow);
    this.state.candidates.push(candidate);
    this.store.event(
      'success',
      'Repair candidate saved',
      `wf${workflow.workflow_version} · ${candidate.planner} · configuration only.`,
      candidate.id,
    );
    await this.store.save();
    return candidate;
  }
  private candidate(id: string) {
    const c = this.state.candidates.find((c) => c.id === id);
    if (!c) throw new Error('Candidate not found');
    return c;
  }
  async verify(id: string) {
    const cycle = this.cycle(),
      candidate = this.candidate(id);
    if (candidate.state !== 'Draft') throw new Error('Only a fresh draft can enter verification.');
    candidate.state = 'Verifying';
    await this.store.save();
    try {
      for (const input of acceptanceInputs) {
        const run = await this.run(candidate.workflow, input, cycle);
        const check = oracleCheck(run, this.state.release);
        run.checks.push(check);
        if (!check.pass) delete run.result;
        candidate.tests.push(run);
        if (!run.result) throw new Error('Candidate failed replay or independent oracle.');
      }
      this.assertCurrent(cycle);
      candidate.checks.push({
        id: 'REGRESSION_SUITE',
        pass: true,
        detail:
          'Two available inputs and one allowed unavailable case passed; ready for final replay.',
      });
      this.store.event(
        'success',
        'Shadow verification passed',
        'Three independent local HTTP replays passed the oracle. No TinyFish execution represented.',
        candidate.id,
      );
    } catch (err) {
      candidate.state = 'Quarantined';
      candidate.checks.push({ id: 'REGRESSION_SUITE', pass: false, detail: safeError(err) });
      this.state.health = 'Degraded';
      delete this.state.published;
      this.store.event('error', 'Candidate quarantined', safeError(err), candidate.id);
    }
    await this.store.save();
    return candidate;
  }
  async promote(id: string) {
    const cycle = this.cycle(),
      c = this.candidate(id);
    if (
      c.state !== 'Verifying' ||
      c.tests.length !== 3 ||
      !c.tests.every((t) => t.result && t.checks.every((x) => x.pass))
    )
      throw new Error('Promotion requires a fully passing current candidate suite.');
    if (c.patch.from_version !== this.state.active_version)
      throw new Error('stale_release: active workflow changed since proposal');
    this.assertCurrent(cycle);
    const previous = this.state.active_version;
    // Provisional activation is never publication. A deadline failure restores
    // the old pointer locally without launching a new, out-of-budget replay.
    this.state.active_version = c.workflow.workflow_version;
    this.state.generation++;
    cycle.generation = this.state.generation;
    delete this.state.published;
    this.store.event(
      'info',
      'Provisional activation',
      'Final current-release replay required before publication.',
      c.id,
    );
    await this.store.save();
    try {
      const final = await this.run(c.workflow, acceptanceInputs[0]!, cycle);
      this.assertCurrent(cycle);
      const oracle = oracleCheck(final, this.state.release);
      final.checks.push(oracle);
      if (!final.result || !oracle.pass) throw new Error('Final replay failed');
      c.state = 'Promoted';
      this.state.activation_history.push(c.workflow.workflow_version);
      this.state.health = 'Healthy';
      this.state.published = final.result;
      this.store.event(
        'success',
        'Verified workflow published',
        `wf${c.workflow.workflow_version} / ${this.state.release}. All mandatory checks and final replay passed.`,
        c.id,
      );
    } catch (err) {
      this.state.active_version = previous;
      this.state.generation++;
      cycle.generation = this.state.generation;
      c.state = 'Quarantined';
      this.state.health = 'Degraded';
      delete this.state.published;
      this.store.event(
        'error',
        'Provisional activation reverted',
        `${safeError(err)}. Previous pointer restored locally; compatibility remains unverified.`,
      );
      if (Date.now() >= cycle.deadline) cycle.status = 'expired';
      // When the same cycle still has capacity, prove the restored version
      // against the current release. An expired cycle performs local cleanup
      // only; it never starts an extra recovery request.
      if (cycle.status === 'active' && cycle.runs < 15 && cycle.release === this.state.release) {
        try {
          const restored = await this.run(this.active, acceptanceInputs[0]!, cycle);
          this.assertCurrent(cycle);
          if (restored.result) {
            this.state.health = 'Healthy';
            this.state.published = restored.result;
          }
          this.store.event(
            restored.result ? 'success' : 'warning',
            'Automatic rollback replay complete',
            restored.result
              ? `Restored wf${previous} passed current-release validation.`
              : `Restored wf${previous} is not compatible; verified publication remains withheld.`,
          );
        } catch {
          this.state.health = 'Degraded';
          delete this.state.published;
          if (Date.now() >= cycle.deadline) cycle.status = 'expired';
        }
      }
    }
    await this.store.save();
    return c;
  }
  async rollback() {
    const history = this.state.activation_history;
    if (history.length < 2) throw new Error('No previously active version to restore.');
    const previous = history[history.length - 2]!;
    this.state.active_version = previous;
    history.pop();
    this.state.generation++;
    this.state.health = 'Degraded';
    delete this.state.published;
    const cycle = this.startCycle();
    await this.store.save();
    const run = await this.run(this.active, acceptanceInputs[0]!, cycle);
    this.assertCurrent(cycle);
    if (run.result) {
      this.state.health = 'Healthy';
      this.state.published = run.result;
    }
    this.store.event(
      run.result ? 'success' : 'warning',
      'Rollback replay complete',
      run.result
        ? `wf${previous} is compatible with ${this.state.release}.`
        : `wf${previous} restored but incompatible with ${this.state.release}; service remains Degraded.`,
    );
    await this.store.save();
    return run;
  }
  async reset() {
    await writeFile(
      join(this.store.dir, `archive-${Date.now()}-${randomUUID()}.json`),
      JSON.stringify(this.state, null, 2),
      { mode: 0o600 },
    );
    const clean = new Store(this.store.dir, this.portalOrigin).state;
    this.store.state = clean;
    this.store.event(
      'info',
      'Sandbox reset',
      'Previous run history archived locally; new r1 / wf1 scenario ready.',
    );
    await this.store.save();
  }
  async demo(useLlm = false) {
    await this.reset();
    await this.baseline();
    await this.switchRelease('r2');
    await this.quote({ sku: 'MOTOR-01', quantity: 1 });
    await this.inspect();
    const c = await this.propose(useLlm);
    await this.verify(c.id);
    if (c.state === 'Verifying') await this.promote(c.id);
    return c;
  }
}
