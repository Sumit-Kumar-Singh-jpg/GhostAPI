import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeliveryJobs } from '../src/delivery-jobs.js';
import type { AgentRunWithStreamingResponse } from '@tiny-fish/sdk';

test('Matrix quota rejection is atomic and queued cancellation never launches', async () => {
  const previous = process.env.TINYFISH_API_KEY;
  process.env.TINYFISH_API_KEY = 'fixture';
  const dir = await mkdtemp(join(tmpdir(), 'matrix-cancel-'));
  let calls = 0;
  const jobs = new DeliveryJobs(dir, () => ({
    agent: {
      stream: async (_params, options) =>
        (async function* (): AsyncGenerator<AgentRunWithStreamingResponse> {
          calls++;
          await new Promise<void>((resolve) => {
            if (options?.signal?.aborted) resolve();
            else options?.signal?.addEventListener('abort', () => resolve(), { once: true });
          });
        })(),
    },
  }));
  try {
    await jobs.load();
    await jobs.startMatrix({
      url: 'https://www.amazon.in/dp/B012345678',
      pincodes: ['560064', '110001', '400001'],
    });
    const queued = jobs.list().find((job) => job.status === 'queued')!;
    await jobs.cancel(queued.id);
    await jobs.close();
    assert.equal(calls, 2);
    assert.equal(jobs.list().find((job) => job.id === queued.id)?.status, 'cancelled');
    const seed = jobs.list()[0]!;
    await writeFile(
      join(dir, 'delivery.json'),
      JSON.stringify(
        Array.from({ length: 29 }, (_, i) => ({ ...seed, id: String(i), status: 'completed' })),
      ),
    );
    const restored = new DeliveryJobs(dir);
    await restored.load();
    await assert.rejects(
      restored.startMatrix({ url: seed.input.url, pincodes: ['560064', '110001'] }),
      /limit/,
    );
    assert.equal(restored.list().length, 29);
    await restored.close();
  } finally {
    await jobs.close();
    if (previous === undefined) delete process.env.TINYFISH_API_KEY;
    else process.env.TINYFISH_API_KEY = previous;
  }
});

test('Matrix runs three isolated checks with two slots and preserves mixed outcomes', async () => {
  const previous = process.env.TINYFISH_API_KEY;
  process.env.TINYFISH_API_KEY = 'fixture';
  const dir = await mkdtemp(join(tmpdir(), 'matrix-'));
  let active = 0,
    max = 0,
    calls = 0;
  const jobs = new DeliveryJobs(dir, () => ({
    agent: {
      stream: async (params) =>
        (async function* (): AsyncGenerator<AgentRunWithStreamingResponse> {
          active++;
          max = Math.max(max, active);
          calls++;
          try {
            await new Promise((resolve) => setTimeout(resolve, 40));
            const pin = params.goal.match(/Requested PIN: (\d+)/)?.[1];
            if (pin === '110001') throw new Error('fixture unavailable');
            yield {
              type: 'COMPLETE',
              run_id: `fixture-${pin}`,
              timestamp: new Date().toISOString(),
              status: 'COMPLETED',
              error: null,
              result: {
                delivery: pin === '560064' ? 'confirmed' : 'rejected',
                observed_pin: pin,
                observed_variant: '16 GB',
                excerpt: 'Explicit fixture delivery message',
              },
            };
          } finally {
            active--;
          }
        })(),
    },
  }));
  try {
    await jobs.load();
    const input = {
      url: 'https://www.amazon.in/dp/B012345678',
      pincodes: ['560064', '110001', '400001'],
    };
    await assert.rejects(
      jobs.startMatrix({ ...input, pincodes: ['560064', '560064'] }),
      /distinct/,
    );
    assert.equal(jobs.list().length, 0);
    const matrix = await jobs.startMatrix(input);
    const duplicate = await jobs.startMatrix(input);
    assert.equal(duplicate.matrix_id, matrix.matrix_id);
    assert.equal(jobs.list().filter((job) => job.status === 'queued').length, 1);
    for (
      let i = 0;
      i < 200 && jobs.list().some((job) => ['queued', 'running'].includes(job.status));
      i++
    )
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(max, 2);
    assert.equal(calls, 3);
    assert.equal(
      jobs.list().find((job) => job.input.pincode === '560064')?.result?.verdict,
      'DELIVERABLE',
    );
    assert.equal(jobs.list().find((job) => job.input.pincode === '110001')?.status, 'failed');
    assert.equal(
      jobs.list().find((job) => job.input.pincode === '400001')?.result?.verdict,
      'NOT_DELIVERABLE',
    );
    await jobs.close();
    const restored = new DeliveryJobs(dir);
    await restored.load();
    assert.equal(restored.list().filter((job) => job.matrix_id === matrix.matrix_id).length, 3);
    await restored.close();
    const records = JSON.parse(await readFile(join(dir, 'delivery.json'), 'utf8'));
    records[0].status = 'queued';
    await writeFile(join(dir, 'delivery.json'), JSON.stringify(records));
    const interrupted = new DeliveryJobs(dir);
    await interrupted.load();
    assert.equal(interrupted.list()[0]?.status, 'interrupted');
    await interrupted.close();
  } finally {
    await jobs.close();
    if (previous === undefined) delete process.env.TINYFISH_API_KEY;
    else process.env.TINYFISH_API_KEY = previous;
  }
});
