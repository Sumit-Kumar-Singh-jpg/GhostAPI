import { test } from 'node:test';
import assert from 'node:assert/strict';
import { comparisonConclusion, type ComparisonBranch } from '../src/evaluation.js';
import { rulesPlan } from '../src/integrations/planner.js';
import { baseline } from '../src/domain/policy.js';
import type { Evidence } from '../src/domain/types.js';
const evidence: Evidence = {
  id: 'rea-observation',
  kind: 'rea-har',
  created_at: new Date().toISOString(),
  release: 'r2',
  origin: 'http://127.0.0.1:3001',
  input: { sku: 'MOTOR-01', quantity: 1 },
  sha256: 'fixture',
  paths: ['/quote-data'],
  fields: [
    'price_basis',
    'unit_price_ex_tax_paise',
    'demo_tax_rate_numerator',
    'demo_tax_rate_denominator',
    'tax_amount_paise',
    'reported_total_paise',
  ],
  limitations: [],
};
const patch = rulesPlan(baseline(evidence.origin), evidence, 2);
function arms(
  withStatus: ComparisonBranch['status'],
  withoutStatus: ComparisonBranch['status'],
): ComparisonBranch[] {
  return [
    {
      arm: 'with_rea',
      status: withStatus,
      context_sha256: 'with',
      patch,
      runs: [],
      reserved_usd: 0,
    },
    {
      arm: 'without_rea',
      status: withoutStatus,
      context_sha256: 'without',
      runs: [],
      reserved_usd: 0,
    },
  ];
}
test('Comparison represents all four paired recovery outcomes and interrupted evaluation', () => {
  assert.equal(
    comparisonConclusion(arms('passed', 'passed'), 'openai').contribution,
    'without_rea_sufficient',
  );
  assert.equal(
    comparisonConclusion(arms('passed', 'failed'), 'openai').contribution,
    'rea_assisted',
  );
  assert.equal(
    comparisonConclusion(arms('failed', 'passed'), 'openai').contribution,
    'evidence_not_helpful',
  );
  assert.equal(
    comparisonConclusion(arms('failed', 'failed'), 'openai').contribution,
    'recovery_failed',
  );
  assert.equal(comparisonConclusion(arms('passed', 'error'), 'openai').status, 'inconclusive');
});
test('Rules outcomes never masquerade as LLM contribution', () => {
  const result = comparisonConclusion(arms('passed', 'abstained'), 'rules fallback');
  assert.equal(result.status, 'completed');
  assert.equal(result.contribution, 'rules_only');
  assert.match(result.summary, /does not establish LLM contribution/);
});
test('A passing candidate without a REA citation cannot prove REA contribution', () => {
  const branches = arms('passed', 'abstained');
  branches[0]!.patch = { ...patch, rea_evidence_ids: [] };
  assert.equal(comparisonConclusion(branches, 'openai').contribution, 'inconclusive');
});
