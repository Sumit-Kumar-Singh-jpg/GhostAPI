import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startRuntime } from '../src/server.js';
import type { AgentRunWithStreamingResponse } from '@tiny-fish/sdk';

test('Delivery API accepts jobs, exposes evidence and rejects cross-origin starts', async () => {
  const previous = process.env.TINYFISH_API_KEY;
  process.env.TINYFISH_API_KEY = 'fixture';
  const runtime = await startRuntime({
    dashboardPort: 0,
    portalPort: 0,
    dataDir: await mkdtemp(join(tmpdir(), 'delivery-api-')),
    deliveryClient: () => ({
      agent: {
        stream: async () =>
          (async function* (): AsyncGenerator<AgentRunWithStreamingResponse> {
            yield {
              type: 'COMPLETE',
              run_id: 'fixture-run',
              timestamp: new Date().toISOString(),
              status: 'COMPLETED',
              error: null,
              result: {
                observed_pin: '560064',
                observed_variant: '16 GB / 512 GB',
                delivery: 'rejected',
                excerpt: 'Cannot deliver to this location',
                listing_in_stock: true,
              },
            };
          })(),
      },
    }),
  });
  try {
    const input = { url: 'https://www.amazon.in/dp/B012345678', pincode: '560064' };
    const headers = { 'Content-Type': 'application/json', 'X-GhostAPI-Client': 'dashboard' };
    assert.equal(
      (
        await fetch(runtime.url + '/api/check-delivery', {
          method: 'POST',
          headers: { ...headers, Origin: 'https://outside.invalid' },
          body: JSON.stringify(input),
        })
      ).status,
      403,
    );
    const response = await fetch(runtime.url + '/api/check-delivery', {
      method: 'POST',
      headers,
      body: JSON.stringify(input),
    });
    assert.equal(response.status, 202);
    const accepted = await response.json();
    let job;
    for (let i = 0; i < 100; i++) {
      job = await (await fetch(runtime.url + accepted.status_url)).json();
      if (job.status !== 'running') break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(job.result.verdict, 'NOT_DELIVERABLE');
    assert.equal(job.result.contradiction, true);
    assert.equal(job.result.source_url, input.url);
    assert.equal(job.result.workflow_version, 'amazon-delivery-v1');
    assert.ok(job.finished_at);
    assert.equal(job.run_id, 'fixture-run');
  } finally {
    await runtime.close();
    if (previous === undefined) delete process.env.TINYFISH_API_KEY;
    else process.env.TINYFISH_API_KEY = previous;
  }
});
