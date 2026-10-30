import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deliveryInput, deliveryVerdict } from '../src/delivery.js';

test('Delivery validates inputs and requires PIN, variant and explicit evidence', () => {
  const input = deliveryInput({
    url: 'https://example.com/laptop',
    pincode: '560064',
    variant: '16 GB',
  });
  assert.throws(() => deliveryInput({ ...input, pincode: '000000' }));
  assert.throws(() => deliveryInput({ ...input, url: 'http://127.0.0.1/laptop' }));
  const observed = {
    observed_pin: '560064',
    observed_variant: '16 GB',
    delivery: 'confirmed' as const,
    excerpt: 'Delivery available to 560064',
  };
  assert.equal(deliveryVerdict(input, observed).verdict, 'DELIVERABLE');
  assert.equal(
    deliveryVerdict(input, { ...observed, reason_code: 'access_blocked' }).verdict,
    'UNKNOWN',
  );
  assert.equal(
    deliveryVerdict(
      { ...input, variant: undefined },
      { ...observed, observed_variant: 'current default' },
    ).verdict,
    'UNKNOWN',
  );
  assert.equal(deliveryVerdict(input, { ...observed, observed_pin: '\u200b' }).verdict, 'UNKNOWN');
  for (const change of [{ observed_pin: '110001' }, { observed_variant: '8 GB' }, { excerpt: '' }])
    assert.equal(deliveryVerdict(input, { ...observed, ...change }).verdict, 'UNKNOWN');
  assert.deepEqual(
    deliveryVerdict(input, { ...observed, delivery: 'rejected', listing_in_stock: true }),
    { verdict: 'NOT_DELIVERABLE', contradiction: true },
  );
  assert.equal(
    deliveryVerdict(input, { ...observed, delivery: 'unclear', listing_in_stock: true }).verdict,
    'UNKNOWN',
  );
});
