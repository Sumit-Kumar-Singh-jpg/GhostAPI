import type { Input, Release, Run } from './domain/types.js';
// Expected values are independent test fixtures. Never import into an executor
// or planner. Only the promotion/test gate may use this file.
export const acceptanceInputs: Input[] = [
  { sku: 'MOTOR-01', quantity: 1 },
  { sku: 'SENSOR-01', quantity: 3 },
  { sku: 'UNAVAILABLE-01', quantity: 1 },
];
const expected: Record<string, Record<string, number | string>> = {
  'r1:MOTOR-01:1': {
    displayed_price_paise: 118000,
    delivery_fee_paise: 0,
    reported_total_paise: 118000,
  },
  'r1:SENSOR-01:3': {
    displayed_price_paise: 2625,
    delivery_fee_paise: 4900,
    reported_total_paise: 12775,
  },
  'r2:MOTOR-01:1': {
    displayed_price_paise: 100000,
    unit_price_ex_tax_paise: 100000,
    price_basis: 'exclusive_of_demo_tax',
    demo_tax_rate_numerator: 18,
    demo_tax_rate_denominator: 100,
    tax_amount_paise: 18000,
    delivery_fee_paise: 0,
    reported_total_paise: 118000,
  },
  'r2:SENSOR-01:3': {
    displayed_price_paise: 2500,
    unit_price_ex_tax_paise: 2500,
    price_basis: 'exclusive_of_demo_tax',
    demo_tax_rate_numerator: 5,
    demo_tax_rate_denominator: 100,
    tax_amount_paise: 375,
    delivery_fee_paise: 4900,
    reported_total_paise: 12775,
  },
};
export function oracleCheck(run: Run, release: Release) {
  if (!run.result)
    return { id: 'INDEPENDENT_ORACLE', pass: false, detail: 'No validated result available' };
  if (run.input.sku === 'UNAVAILABLE-01')
    return {
      id: 'INDEPENDENT_ORACLE',
      pass: run.result.outcome === 'unavailable' && run.result.verified_total_paise === undefined,
      detail: 'Allowed catalog item has no quote; no amount invented',
    };
  const fixture = expected[`${release}:${run.input.sku}:${run.input.quantity}`];
  const values = run.observation as unknown as Record<string, unknown>;
  return {
    id: 'INDEPENDENT_ORACLE',
    pass: Boolean(fixture) && Object.entries(fixture!).every(([k, v]) => values[k] === v),
    detail: 'All observed monetary components exactly match independent acceptance fixture',
  };
}
