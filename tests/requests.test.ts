import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ResearchRequests, validateRequest } from '../src/requests.js';

test('request intake persists and deduplicates concurrent submissions without claiming verification', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ghostapi-requests-'));
  try {
    const requests = new ResearchRequests(dir);
    await requests.load();
    const input = {
      tool: 'shopping',
      intent: 'check_listing',
      input: 'https://shop.example/item?variant=blue',
    };
    const results = await Promise.all(Array.from({ length: 5 }, () => requests.create(input)));
    assert.equal(new Set(results.map((item) => item.id)).size, 1);
    await requests.create({
      tool: 'internships',
      intent: 'check_internship',
      input: 'Example internship description',
    });
    const restarted = new ResearchRequests(dir);
    await restarted.load();
    assert.equal(restarted.list().length, 2);
    assert.ok(restarted.list().every((item) => item.status === 'not_checked'));
    assert.equal(restarted.list()[1]?.input, input.input);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('request intake rejects unsupported tasks, missing input and unsafe listing URLs', () => {
  for (const input of [
    null,
    {},
    { tool: 'shopping', intent: 'check_internship', input: 'text' },
    ...[
      'http://shop.example',
      'https://127.0.0.1/item',
      'https://localhost/item',
      'https://user:pass@shop.example',
      'https://shop.example?token=secret',
      'not a URL',
    ].map((input) => ({ tool: 'shopping', intent: 'check_listing', input })),
  ]) {
    assert.throws(() => validateRequest(input));
  }
  assert.equal(
    validateRequest({ tool: 'shopping', intent: 'find_product', input: '  Black headphones  ' })
      .input,
    'Black headphones',
  );
});
