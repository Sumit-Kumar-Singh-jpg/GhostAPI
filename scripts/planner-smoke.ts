import 'dotenv/config';
import { tinyfishPlan, tinyfishPlannerReservation } from '../src/integrations/planner.js';
import { baseline, applyPatch } from '../src/domain/policy.js';
import type { Evidence } from '../src/domain/types.js';

const evidence: Evidence = {
  id: 'smoke-typed-evidence',
  kind: 'local-http',
  created_at: new Date().toISOString(),
  release: 'r2',
  origin: 'http://127.0.0.1:3001',
  input: { sku: 'MOTOR-01', quantity: 1 },
  sha256: 'synthetic-schema-only-smoke',
  paths: ['/quote-data'],
  fields: [
    'price_basis',
    'unit_price_ex_tax_paise',
    'demo_tax_rate_numerator',
    'demo_tax_rate_denominator',
    'tax_amount_paise',
    'reported_total_paise',
  ],
  limitations: ['Synthetic typed schema smoke; not a real REA contribution test.'],
};
try {
  const bound = await tinyfishPlannerReservation();
  if (bound > 3) throw new Error('Planner smoke would exceed its USD 3 reservation ceiling.');
  const result = await tinyfishPlan(baseline(evidence.origin), evidence, 2, 60000);
  const candidate = applyPatch(baseline(evidence.origin), result.patch, [evidence.id], 2);
  console.log(
    JSON.stringify({
      scope: 'synthetic-schema-only-planner-smoke',
      receipt: result.receipt,
      patch_valid: true,
      version: candidate.workflow.workflow_version,
      reserved_usd: bound,
    }),
  );
} catch (error) {
  console.error(
    error instanceof Error
      ? error.message.replaceAll(process.env.TINYFISH_API_KEY ?? '__missing__', '[redacted]')
      : 'Planner smoke failed',
  );
  process.exitCode = 1;
}
