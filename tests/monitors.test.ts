import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalMonitors, monitorTarget } from '../src/monitors.js';
import { ResearchJobs } from '../src/research-jobs.js';
import type { ResearchRequest } from '../src/requests.js';

test('Opt-in checks diff observations, preserve baselines on errors, pause, persist and avoid catch-up bursts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ghostapi-monitors-'));
  let clock = Date.now(),
    price = '100',
    failed = false,
    freshCalls = 0;
  const observe = async (_target: unknown, fresh: boolean) => {
    if (fresh) freshCalls++;
    if (failed) throw new Error('Source changed; recapture required.');
    return { label: 'Product price', values: { price } };
  };
  const monitors = new LocalMonitors(dir, observe, () => clock);
  await monitors.load();
  const target = { kind: 'shopping', request_id: 'fixture' };
  const first = await monitors.create(target, 60);
  assert.equal(freshCalls, 0);
  assert.equal((await monitors.create(target)).id, first.id);
  clock += 60 * 60000;
  price = '120';
  await monitors.tick();
  assert.equal(freshCalls, 1);
  assert.deepEqual(monitors.list()[0]?.history[0]?.changes, [
    { field: 'price', before: '100', after: '120' },
  ]);
  failed = true;
  await monitors.check(first.id);
  assert.equal(monitors.list()[0]?.status, 'error');
  assert.equal(monitors.list()[0]?.values.price, '120');
  await monitors.update(first.id, false);
  clock += 24 * 60 * 60000;
  await monitors.tick();
  assert.equal(freshCalls, 2);
  await monitors.close();
  const restored = new LocalMonitors(dir, observe, () => clock);
  await restored.load();
  assert.equal(restored.list()[0]?.enabled, false);
  await restored.update(first.id, true);
  await restored.tick();
  assert.equal(freshCalls, 2);
  assert.ok(Date.parse(restored.list()[0]!.next_at) > clock);
  await restored.close();
});

test('Monitor target rejects raw URLs and interrupted monitors retain previous values', async () => {
  assert.throws(() =>
    monitorTarget({ kind: 'source_api', website_id: '../escape', candidate_id: 'x' }),
  );
  assert.throws(() => monitorTarget({ kind: 'url', url: 'http://localhost/' }));
  const dir = await mkdtemp(join(tmpdir(), 'ghostapi-monitor-recovery-'));
  await writeFile(
    join(dir, 'monitors.json'),
    JSON.stringify([
      {
        id: 'fixture',
        target: { kind: 'shopping', request_id: 'fixture' },
        label: 'Fixture',
        enabled: true,
        interval_minutes: 60,
        next_at: new Date(0).toISOString(),
        phase: 'checking',
        status: 'ready',
        values: { price: '100' },
        history: [],
      },
    ]),
  );
  const monitors = new LocalMonitors(dir, async () => {
    throw new Error('Must not auto-run on restart');
  });
  await monitors.load();
  await monitors.tick();
  assert.equal(monitors.list()[0]?.phase, 'idle');
  assert.equal(monitors.list()[0]?.status, 'error');
  assert.equal(monitors.list()[0]?.values.price, '100');
  assert.match(monitors.list()[0]!.history[0]!.message, /Interrupted/);
  await monitors.close();
});

test('Research rolling daily budget survives restart; interrupted and corrupt storage fail safely', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ghostapi-budget-'));
  const request: ResearchRequest = {
    id: 'request',
    tool: 'shopping',
    intent: 'find_product',
    input: 'Example',
    created_at: new Date().toISOString(),
    status: 'not_checked',
  };
  const fixtures = Array.from({ length: 30 }, (_, i) => ({
    id: String(i),
    request_id: 'request',
    status: i ? 'failed' : 'running',
    started_at: new Date().toISOString(),
  }));
  await writeFile(join(dir, 'shopping.json'), JSON.stringify(fixtures));
  const jobs = new ResearchJobs(
    dir,
    'shopping',
    () => request,
    async () => ({ partial: false }),
  );
  await jobs.load();
  assert.equal(jobs.list()[0]?.status, 'failed');
  assert.match(jobs.list()[0]!.error!, /Interrupted/);
  await assert.rejects(jobs.start('request', true), /Daily run limit/);
  await jobs.close();
  await assert.rejects(jobs.start('request', false), /shutting down/);
  await writeFile(join(dir, 'shopping.json'), '{"broken":true}');
  const corrupt = new ResearchJobs(
    dir,
    'shopping',
    () => request,
    async () => ({ partial: false }),
  );
  await assert.rejects(corrupt.load(), /invalid/);
  assert.equal(await readFile(join(dir, 'shopping.json'), 'utf8'), '{"broken":true}');
});
