import { ajv, parseInput } from './policy.js';
import type { Check, Input, Observation, Release, Verified, Workflow } from './types.js';

const integer = { type: 'integer', minimum: 0, maximum: 1_000_000_000_000 };
const common = {
  outcome: { type: 'string', enum: ['quote', 'unavailable'] },
  sku: { type: 'string' },
  quantity: { type: 'integer', minimum: 1, maximum: 1000 },
  currency: { type: 'string', const: 'INR' },
  site_release: { type: 'string', enum: ['r1', 'r2'] },
  quote_id: { type: 'string', minLength: 1, maxLength: 120 },
  source_url: { type: 'string', minLength: 1, maxLength: 2000 },
  observed_at: { type: 'string', minLength: 1 },
  evidence_ids: {
    type: 'array',
    minItems: 1,
    maxItems: 10,
    items: { type: 'string', minLength: 1 },
  },
};
const requiredCommon = Object.keys(common);
const quoteProps = {
  displayed_price_paise: integer,
  basis_label_text: { type: 'string', minLength: 1 },
  delivery_fee_paise: integer,
  reported_total_paise: integer,
};
const exclusiveProps = {
  price_basis: { type: 'string', const: 'exclusive_of_demo_tax' },
  unit_price_ex_tax_paise: integer,
  demo_tax_rate_numerator: { type: 'integer', minimum: 0, maximum: 10000 },
  demo_tax_rate_denominator: { type: 'integer', minimum: 1, maximum: 10000 },
  tax_amount_paise: integer,
};
const branch = (exclusive: boolean, unavailable: boolean) => ({
  type: 'object',
  additionalProperties: false,
  required: [
    ...requiredCommon,
    ...(unavailable
      ? ['reason_code']
      : [...Object.keys(quoteProps), ...(exclusive ? Object.keys(exclusiveProps) : [])]),
  ],
  properties: {
    ...common,
    outcome: { type: 'string', const: unavailable ? 'unavailable' : 'quote' },
    ...(unavailable
      ? { reason_code: { type: 'string', enum: ['not_quoted', 'out_of_stock'] } }
      : { ...quoteProps, ...(exclusive ? exclusiveProps : {}) }),
  },
});
const schemas = {
  QUOTE_OR_UNAVAILABLE_WF1: ajv.compile<Observation>({
    oneOf: [branch(false, false), branch(false, true)],
  }),
  QUOTE_OR_UNAVAILABLE_WF2: ajv.compile<Observation>({
    oneOf: [branch(true, false), branch(false, true)],
  }),
};
export function taxPaise(
  unit: number,
  quantity: number,
  numerator: number,
  denominator: number,
): number {
  if (
    ![unit, quantity, numerator, denominator].every(Number.isSafeInteger) ||
    unit < 0 ||
    quantity < 1 ||
    numerator < 0 ||
    denominator < 1
  )
    throw new Error('invalid money components');
  const n = BigInt(unit) * BigInt(quantity) * BigInt(numerator),
    d = BigInt(denominator);
  const result = (2n * n + d) / (2n * d);
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('money overflow');
  return Number(result);
}
export function validateObservation(
  raw: unknown,
  workflow: Workflow,
  input: Input,
  release: Release,
  evidenceIds: string[],
  notBefore: number,
  now = Date.now(),
): { checks: Check[]; result?: Verified } {
  parseInput(input);
  const checks: Check[] = [];
  const check = (id: string, pass: boolean, detail: string) => checks.push({ id, pass, detail });
  if (
    workflow.observed_schema_id === 'QUOTE_OR_UNAVAILABLE_WF1' &&
    raw &&
    typeof raw === 'object' &&
    'outcome' in raw &&
    raw.outcome === 'quote' &&
    'basis_label_text' in raw &&
    typeof raw.basis_label_text === 'string'
  ) {
    check(
      'PINNED_PRICE_BASIS',
      /incl/i.test(raw.basis_label_text) && !/before tax/i.test(raw.basis_label_text),
      'Saved contract requires an inclusive unit price; current label must retain that meaning',
    );
  }
  const schema = schemas[workflow.observed_schema_id];
  check(
    'SCHEMA',
    schema(raw),
    schema(raw) ? 'Versioned result schema passed' : ajv.errorsText(schema.errors),
  );
  if (!schema(raw)) return { checks };
  const o = raw;
  check(
    'POLICY_IMMUTABLE',
    workflow.mode === 'read_only' && workflow.mandatory_validation_policy_id === 'QUOTE_SAFETY_V1',
    'Read-only scope and mandatory validation policy',
  );
  let sourceAllowed = false;
  try {
    const u = new URL(o.source_url);
    sourceAllowed =
      u.origin === workflow.allowed_origin &&
      !u.username &&
      !u.password &&
      ['/catalog', '/quotes', '/quote-data'].includes(u.pathname) &&
      [...u.searchParams.keys()].every((k) => ['sku', 'quantity'].includes(k)) &&
      u.searchParams.getAll('sku').length === 1 &&
      u.searchParams.getAll('quantity').length === 1 &&
      u.searchParams.get('sku') === input.sku &&
      u.searchParams.get('quantity') === String(input.quantity) &&
      !u.hash;
  } catch {
    /* invalid URL fails the policy check */
  }
  check(
    'ORIGIN_ALLOWED',
    sourceAllowed,
    'Source is an enrolled read-only route bound to the requested input',
  );
  check(
    'INPUT_IDENTITY',
    o.sku === input.sku && o.quantity === input.quantity,
    'Observed SKU and quantity match request',
  );
  check(
    'RELEASE_CURRENT',
    o.site_release === release,
    `Expected site ${release}, observed ${o.site_release}`,
  );
  const time = Date.parse(o.observed_at);
  check(
    'EVIDENCE_FRESH',
    Number.isFinite(time) && time >= notBefore && time <= now + 2000,
    'Observation belongs to the current cycle',
  );
  check(
    'EVIDENCE_RESOLVES',
    o.evidence_ids.every((id) => evidenceIds.includes(id)),
    'Evidence references resolve to actual executor records',
  );
  let verifiedTotal: number | undefined;
  if (o.outcome === 'quote') {
    const exclusive = workflow.observed_schema_id === 'QUOTE_OR_UNAVAILABLE_WF2';
    check(
      'PRICE_BASIS',
      exclusive
        ? o.price_basis === 'exclusive_of_demo_tax' &&
            /before tax/i.test(o.basis_label_text!) &&
            !/incl/i.test(o.basis_label_text!)
        : /incl/i.test(o.basis_label_text!) && !/before tax/i.test(o.basis_label_text!),
      exclusive
        ? 'Exclusive basis explicitly grounded'
        : 'Inclusive baseline basis remains unchanged',
    );
    if (exclusive) {
      check(
        'PRICE_ALIAS',
        o.displayed_price_paise === o.unit_price_ex_tax_paise,
        'Normalized unit price equals observed ex-tax price',
      );
      let tax: number;
      try {
        tax = taxPaise(
          o.unit_price_ex_tax_paise!,
          o.quantity,
          o.demo_tax_rate_numerator!,
          o.demo_tax_rate_denominator!,
        );
      } catch {
        check('MONEY_BOUNDS', false, 'Rate-derived tax exceeds supported safe-integer bounds');
        return { checks };
      }
      check(
        'TAX_ARITHMETIC',
        tax === o.tax_amount_paise,
        `Computed tax ${tax} paise; observed ${o.tax_amount_paise}`,
      );
      verifiedTotal = o.unit_price_ex_tax_paise! * o.quantity + tax + o.delivery_fee_paise!;
    } else verifiedTotal = o.displayed_price_paise! * o.quantity + o.delivery_fee_paise!;
    check(
      'TOTAL_ARITHMETIC',
      Number.isSafeInteger(verifiedTotal) && verifiedTotal === o.reported_total_paise,
      `Computed total ${verifiedTotal} paise; observed ${o.reported_total_paise}`,
    );
  }
  if (!checks.every((c) => c.pass)) return { checks };
  return {
    checks,
    result: {
      ...o,
      workflow_version: workflow.workflow_version,
      ...(verifiedTotal === undefined ? {} : { verified_total_paise: verifiedTotal }),
      validation_policy_version: 'QUOTE_SAFETY_V1',
      verification_time: new Date(now).toISOString(),
    },
  };
}
