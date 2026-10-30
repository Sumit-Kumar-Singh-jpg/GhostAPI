import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startRuntime } from '../src/server.js';
import type { AgentRunWithStreamingResponse } from '@tiny-fish/sdk';

test('Delivery monitoring preserves uncertainty and replaces a version only after fresh regression checks', async () => {
  const previous = process.env.TINYFISH_API_KEY;
  process.env.TINYFISH_API_KEY = 'fixture';
  let mode = 'confirmed',
    calls = 0;
  const runtime = await startRuntime({
    dashboardPort: 0,
    portalPort: 0,
    dataDir: await mkdtemp(join(tmpdir(), 'delivery-monitor-')),
    deliveryClient: () => ({
      agent: {
        stream: async (params) =>
          (async function* (): AsyncGenerator<AgentRunWithStreamingResponse> {
            calls++;
            if (mode === 'blocked')
              throw Object.assign(new Error('fixture block'), { statusCode: 403 });
            const pin = params.goal.match(/Requested PIN: (\d+)/)?.[1];
            yield {
              type: 'COMPLETE',
              run_id: `fixture-${calls}`,
              timestamp: new Date().toISOString(),
              status: 'COMPLETED',
              error: null,
              result: {
                observed_pin: pin,
                observed_variant: '16 GB',
                delivery: mode,
                ...(mode === 'page_blocked' ? { reason_code: 'access_blocked' } : {}),
                excerpt: mode === 'confirmed' ? 'Delivery available' : 'Delivery unavailable',
                listing_in_stock: true,
              },
            };
          })(),
      },
    }),
  });
  const post = async (path: string, data: unknown, status = 200) => {
    const response = await fetch(runtime.url + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-GhostAPI-Client': 'dashboard' },
      body: JSON.stringify(data),
    });
    const json = await response.json();
    assert.equal(response.status, status, JSON.stringify(json));
    return json;
  };
  const wait = async (id: string) => {
    for (let i = 0; i < 100; i++) {
      const job = await (await fetch(runtime.url + '/api/delivery-jobs/' + id)).json();
      if (job.status !== 'running') return job;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('Fixture timeout');
  };
  try {
    const initial = await post(
      '/api/check-delivery',
      { url: 'https://www.amazon.in/dp/B012345678', pincode: '560064' },
      202,
    );
    await wait(initial.job_id);
    const draft = (await post('/api/delivery-workflows', { job_id: initial.job_id }, 201)).workflow;
    await post(`/api/delivery-workflows/${draft.id}/publish`, { digest: draft.digest });
    const invoked = await post(
      `/api/delivery-workflows/${draft.id}/invoke`,
      { pincode: '560064' },
      202,
    );
    await wait(invoked.job_id);
    const target = { kind: 'delivery', workflow_id: draft.id, pincode: '560064' };
    const created = await post('/api/monitors', { action: 'create', target });
    const monitor = created.monitors.find(
      (item: { target: { kind: string } }) => item.target.kind === 'delivery',
    );
    assert.equal(calls, 2);
    mode = 'rejected';
    const changed = await post('/api/monitors', { action: 'check', id: monitor.id });
    assert.equal(changed.monitors[0].status, 'changed');
    assert.equal(changed.monitors[0].values.Availability, 'NOT_DELIVERABLE');
    mode = 'unclear';
    await post('/api/monitors', { action: 'check', id: monitor.id });
    const uncertain = await post('/api/monitors', { action: 'check', id: monitor.id });
    assert.equal(uncertain.monitors[0].status, 'error');
    assert.equal(uncertain.monitors[0].values.Availability, 'NOT_DELIVERABLE');
    let workflows = await (await fetch(runtime.url + '/api/delivery-workflows')).json();
    assert.equal(workflows.workflows[0].health, 'suspected_drift');
    mode = 'page_blocked';
    await post('/api/monitors', { action: 'check', id: monitor.id });
    workflows = await (await fetch(runtime.url + '/api/delivery-workflows')).json();
    assert.equal(workflows.workflows[0].health, 'access_blocked');
    mode = 'blocked';
    await post('/api/monitors', { action: 'check', id: monitor.id });
    workflows = await (await fetch(runtime.url + '/api/delivery-workflows')).json();
    assert.equal(workflows.workflows[0].health, 'provider_rejected');
    mode = 'confirmed';
    const recovered = await post(
      `/api/delivery-workflows/${draft.id}/invoke`,
      { pincode: '110001' },
      202,
    );
    await wait(recovered.job_id);
    const replacement = (
      await post(
        '/api/delivery-workflows',
        { job_id: recovered.job_id, replaces_id: draft.id },
        201,
      )
    ).workflow;
    await post(
      `/api/delivery-workflows/${replacement.id}/publish`,
      { digest: replacement.digest },
      409,
    );
    mode = 'unclear';
    await post(`/api/delivery-workflows/${replacement.id}/validate`, {});
    await post(
      `/api/delivery-workflows/${replacement.id}/publish`,
      { digest: replacement.digest },
      409,
    );
    mode = 'confirmed';
    const validated = await post(`/api/delivery-workflows/${replacement.id}/validate`, {});
    assert.equal(validated.workflow.validation_job_ids.length, 2);
    await post(`/api/delivery-workflows/${replacement.id}/publish`, { digest: replacement.digest });
    const before = calls;
    await post(`/api/delivery-workflows/${draft.id}/invoke`, { pincode: '560064' }, 400);
    const retired = await post('/api/monitors', { action: 'check', id: monitor.id });
    assert.equal(calls, before);
    assert.equal(retired.monitors[0].values.Availability, 'NOT_DELIVERABLE');
    assert.equal(retired.monitors[0].status, 'error');
    workflows = await (await fetch(runtime.url + '/api/delivery-workflows')).json();
    assert.equal(
      workflows.workflows.find((item: { id: string }) => item.id === draft.id).status,
      'retired',
    );
  } finally {
    await runtime.close();
    if (previous === undefined) delete process.env.TINYFISH_API_KEY;
    else process.env.TINYFISH_API_KEY = previous;
  }
});
