import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeliveryJobs } from '../src/delivery-jobs.js';
import { DeliveryWorkflows } from '../src/delivery-workflows.js';
import type { AgentRunWithStreamingResponse } from '@tiny-fish/sdk';

test('Reviewed contracts gate fresh runs, bind provenance and survive restart and retirement', async () => {
  const previous = process.env.TINYFISH_API_KEY;
  process.env.TINYFISH_API_KEY = 'fixture';
  let calls = 0;
  const dir = await mkdtemp(join(tmpdir(), 'delivery-contract-'));
  const jobs = new DeliveryJobs(dir, () => ({
    agent: {
      stream: async () =>
        (async function* (): AsyncGenerator<AgentRunWithStreamingResponse> {
          calls++;
          yield {
            type: 'COMPLETE',
            run_id: `fixture-${calls}`,
            timestamp: new Date().toISOString(),
            status: 'COMPLETED',
            error: null,
            result: {
              observed_pin: '560064',
              observed_variant: '16 GB',
              delivery: 'confirmed',
              excerpt: 'Delivery available',
            },
          };
        })(),
    },
  }));
  const workflows = new DeliveryWorkflows(dir, jobs);
  const wait = async () => {
    for (let i = 0; i < 100 && jobs.list().some((job) => job.status === 'running'); i++)
      await new Promise((resolve) => setTimeout(resolve, 10));
  };
  try {
    await jobs.load();
    await workflows.load();
    await assert.rejects(workflows.discover('missing'));
    const baseline = await jobs.start({
      url: 'https://www.amazon.in/dp/B012345678',
      pincode: '560064',
    });
    await wait();
    const draft = await workflows.discover(baseline.id);
    assert.equal(calls, 1);
    assert.equal(draft.status, 'draft');
    await assert.rejects(workflows.invoke(draft.id, { pincode: '560064' }));
    await assert.rejects(workflows.publish(draft.id, 'wrong'));
    await workflows.publish(draft.id, draft.digest);
    await assert.rejects(
      workflows.invoke(draft.id, { pincode: '560064', url: 'https://outside.invalid' }),
    );
    const a = await workflows.invoke(draft.id, { pincode: '560064' });
    await wait();
    const b = await workflows.invoke(draft.id, { pincode: '560064' });
    await wait();
    assert.notEqual(a.id, b.id);
    assert.equal(calls, 3);
    assert.deepEqual(b.contract, { id: draft.id, version: 1, digest: draft.digest });
    const revision = await workflows.discover(b.id);
    assert.equal(revision.version, 2);
    assert.equal(
      workflows.documentation(draft.id, true).components.securitySchemes.sessionCookie.name,
      '__Host-ghostapi_session',
    );
    const restored = new DeliveryWorkflows(dir, jobs);
    await restored.load();
    assert.equal(restored.list().find((item) => item.id === draft.id)?.status, 'published');
    await restored.retire(draft.id);
    await assert.rejects(restored.invoke(draft.id, { pincode: '560064' }));
    await restored.close();
    const file = join(dir, 'delivery-workflows.json');
    const records = JSON.parse(await readFile(file, 'utf8'));
    records[0].spec.url = 'https://tampered.invalid';
    const corrupt = JSON.stringify(records);
    await writeFile(file, corrupt);
    await assert.rejects(new DeliveryWorkflows(dir, jobs).load(), /Invalid/);
    assert.equal(await readFile(file, 'utf8'), corrupt);
  } finally {
    await workflows.close();
    await jobs.close();
    if (previous === undefined) delete process.env.TINYFISH_API_KEY;
    else process.env.TINYFISH_API_KEY = previous;
  }
});
