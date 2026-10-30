import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeliveryJobs } from '../src/delivery-jobs.js';
import type { AgentRunWithStreamingResponse } from '@tiny-fish/sdk';

test('Delivery timeout produces no verdict and persisted quota survives restart', async () => {
  const previous = process.env.TINYFISH_API_KEY;
  process.env.TINYFISH_API_KEY = 'fixture';
  const dir = await mkdtemp(join(tmpdir(), 'delivery-timeout-'));
  const jobs = new DeliveryJobs(
    dir,
    () => ({
      agent: {
        stream: async (_params, options) => {
          await new Promise<void>((_resolve, reject) =>
            options?.signal?.addEventListener('abort', () => reject(new Error('timeout')), {
              once: true,
            }),
          );
          throw new Error('unreachable');
        },
      },
    }),
    15,
  );
  try {
    await jobs.load();
    await jobs.start({ url: 'https://www.amazon.in/dp/B012345678', pincode: '560064' });
    for (let i = 0; i < 100 && jobs.list()[0]?.status === 'running'; i++)
      await new Promise((r) => setTimeout(r, 10));
    assert.equal(jobs.list()[0]?.status, 'failed');
    assert.equal(jobs.list()[0]?.result, undefined);
    await jobs.close();
    const seed = jobs.list()[0]!;
    await writeFile(
      join(dir, 'delivery.json'),
      JSON.stringify(Array.from({ length: 30 }, (_, i) => ({ ...seed, id: String(i) }))),
    );
    const restored = new DeliveryJobs(dir);
    await restored.load();
    await assert.rejects(restored.start(seed.input), /limit/);
    await restored.close();
  } finally {
    await jobs.close();
    if (previous === undefined) delete process.env.TINYFISH_API_KEY;
    else process.env.TINYFISH_API_KEY = previous;
  }
});

test('Delivery reserves concurrency before persistence and discards cancelled results', async () => {
  const previous = process.env.TINYFISH_API_KEY;
  process.env.TINYFISH_API_KEY = 'fixture';
  const dir = await mkdtemp(join(tmpdir(), 'delivery-concurrency-'));
  const jobs = new DeliveryJobs(dir, () => ({
    agent: {
      stream: async (_params, options) =>
        (async function* (): AsyncGenerator<AgentRunWithStreamingResponse> {
          await new Promise<void>((resolve) => {
            if (options?.signal?.aborted) resolve();
            else options?.signal?.addEventListener('abort', () => resolve(), { once: true });
          });
          yield {
            type: 'COMPLETE',
            run_id: 'late',
            timestamp: new Date().toISOString(),
            status: 'COMPLETED',
            error: null,
            result: {
              delivery: 'confirmed',
              observed_pin: '560064',
              observed_variant: '16GB',
              excerpt: 'Available',
            },
          };
        })(),
    },
  }));
  try {
    await jobs.load();
    const first = jobs.start({ url: 'https://www.amazon.in/dp/B012345678', pincode: '560064' });
    const second = jobs.start({ url: 'https://www.amazon.in/dp/B012345679', pincode: '560064' });
    await assert.rejects(
      jobs.start({ url: 'https://www.amazon.in/dp/B012345670', pincode: '560064' }),
      /limit/,
    );
    const [a, b] = await Promise.all([first, second]);
    await jobs.cancel(a.id);
    await jobs.cancel(b.id);
    await jobs.close();
    assert.ok(jobs.list().every((job) => job.status === 'cancelled' && !job.result));
  } finally {
    await jobs.close();
    if (previous === undefined) delete process.env.TINYFISH_API_KEY;
    else process.env.TINYFISH_API_KEY = previous;
  }
});

test('Provider rejection fails once without inventing evidence or retrying', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'delivery-rejected-'));
  let calls = 0;
  const previous = process.env.TINYFISH_API_KEY;
  process.env.TINYFISH_API_KEY = 'fixture';
  try {
    const jobs = new DeliveryJobs(dir, () => ({
      agent: {
        stream: async () => {
          calls++;
          throw Object.assign(new Error('Private provider payload'), { statusCode: 403 });
        },
      },
    }));
    await jobs.load();
    await jobs.start({ url: 'https://www.amazon.in/dp/B012345678', pincode: '560064' });
    for (let i = 0; i < 100 && jobs.list()[0]?.status === 'running'; i++)
      await new Promise((r) => setTimeout(r, 10));
    assert.equal(calls, 1);
    assert.equal(jobs.list()[0]?.status, 'failed');
    assert.equal(jobs.list()[0]?.result, undefined);
    assert.match(jobs.list()[0]?.error ?? '', /HTTP 403/);
    assert.ok(!JSON.stringify(jobs.list()).includes('Private provider payload'));
    await jobs.close();
  } finally {
    if (previous === undefined) delete process.env.TINYFISH_API_KEY;
    else process.env.TINYFISH_API_KEY = previous;
  }
});

test('Delivery persists evidence, expires viewing links and recovers interrupted checks', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'delivery-'));
  const previous = process.env.TINYFISH_API_KEY;
  process.env.TINYFISH_API_KEY = 'fixture';
  try {
    const jobs = new DeliveryJobs(dir, () => ({
      agent: {
        stream: async () =>
          (async function* (): AsyncGenerator<AgentRunWithStreamingResponse> {
            yield {
              type: 'STREAMING_URL',
              run_id: 'fixture-run',
              streaming_url: 'https://example.com/temporary-view',
              timestamp: new Date().toISOString(),
            };
            yield {
              type: 'COMPLETE',
              run_id: 'fixture-run',
              timestamp: new Date().toISOString(),
              status: 'COMPLETED',
              error: null,
              result: {
                observed_pin: '560064',
                observed_variant: '16 GB',
                delivery: 'confirmed',
                excerpt: 'Delivery available to 560064',
              },
            };
          })(),
      },
    }));
    await jobs.load();
    const job = await jobs.start({ url: 'https://www.amazon.in/dp/B012345678', pincode: '560064' });
    for (let i = 0; i < 100 && jobs.list()[0]?.status === 'running'; i++)
      await new Promise((r) => setTimeout(r, 10));
    assert.equal(jobs.list()[0]?.result?.verdict, 'DELIVERABLE');
    await jobs.close();
    assert.equal(jobs.list()[0]?.live_url, undefined);
    assert.ok(!(await readFile(join(dir, 'delivery.json'), 'utf8')).includes('temporary-view'));
    await assert.rejects(jobs.start(job.input), /stopping/);
    const records = JSON.parse(await readFile(join(dir, 'delivery.json'), 'utf8'));
    records[0].status = 'running';
    await writeFile(join(dir, 'delivery.json'), JSON.stringify(records));
    const restored = new DeliveryJobs(dir);
    await restored.load();
    assert.equal(restored.list()[0]?.status, 'interrupted');
    await restored.close();
  } finally {
    if (previous === undefined) delete process.env.TINYFISH_API_KEY;
    else process.env.TINYFISH_API_KEY = previous;
  }
});
