import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildVisual } from '../src/websites/visual.js';
import { inspectPage } from '../src/websites/inspect.js';
import { Websites } from '../src/websites/service.js';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { captureRequest, inspectCloneCapture } from '../src/websites/rea.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('Large early stylesheets cannot starve later layout styles or visible images', async () => {
  const page = {
    url: 'https://shop.example/',
    contentType: 'text/html',
    body: '<link rel="stylesheet" href="/first.css"><link rel="stylesheet" href="/nav.css"><h1>Shop</h1><img src="/hero.png">',
  };
  const result = await buildVisual(page, inspectPage(page).fields, 'site', async (url) => {
    if (url.endsWith('/first.css'))
      return {
        url,
        contentType: 'text/css',
        body: Array.from(
          { length: 40 },
          (_, i) => `.unused-${i}{background:url(/decor-${i}.png)}`,
        ).join(''),
      };
    if (url.endsWith('/nav.css'))
      return { url, contentType: 'text/css', body: '#navbar{background:#131921}' };
    return { url, contentType: 'image/png', body: 'aGVybw==' };
  });
  assert.match(result.html, /#navbar\{background:#131921\}/);
  assert.match(result.html, /<img src="data:image\/png;base64,aGVybw=="/);
});

test('Visual capture bundles styles and images, links fields and removes executable markup', async () => {
  const page = {
    url: 'https://shop.example/book',
    contentType: 'text/html',
    body: `<html><head><link rel="stylesheet" href="/site.css"></head><body onload="alert(1)"><h1>Book</h1><p class="price_color">£12</p><img src="/cover.png"><script>alert(1)</script><iframe src="/private"></iframe><form action="/buy"><input value="secret"><button formaction="/buy">Buy</button></form><a href="https://evil.example">Leave</a></body></html>`,
  };
  const requests: string[] = [];
  const result = await buildVisual(page, inspectPage(page).fields, 'site', async (url) => {
    requests.push(url);
    return url.endsWith('.css')
      ? {
          url,
          contentType: 'text/css',
          body: '@import "https://evil.example/style";h1{color:red}body{background:url(/cover.png)}',
        }
      : { url, contentType: 'image/png', body: 'aW1hZ2U=' };
  });
  assert.match(result.html, /color:red/);
  assert.match(result.html, /data:image\/png;base64,aW1hZ2U=/);
  assert.match(result.html, /data-ghost-field="price"/);
  assert.doesNotMatch(
    result.html,
    /<script|<iframe|onload=|(?:^|\s)action=|formaction=|value="secret"|@import|href="https:\/\/evil/,
  );
  assert.equal(requests.filter((url) => url.endsWith('/cover.png')).length, 1);
  assert.equal(
    result.bindings.find((b) => b.key === 'price')?.endpoint,
    '/api/websites/site/fields/price',
  );
});

test('Unavailable assets do not fabricate successful visual fidelity', async () => {
  const page = {
    url: 'https://shop.example/',
    contentType: 'text/html',
    body: '<h1>Title</h1><img src="/missing.png">',
  };
  const result = await buildVisual(page, inspectPage(page).fields, 'site', async () => {
    throw new Error('Missing');
  });
  assert.match(result.notes.join(' '), /1 assets unavailable/);
  assert.doesNotMatch(result.html, /src="\/missing/);
});

test('Static SVG icons survive while executable SVG content is removed', async () => {
  const page = {
    url: 'https://shop.example/',
    contentType: 'text/html',
    body: '<svg viewBox="0 0 10 10"><path d="M0 0L10 10"/><script>alert(1)</script><foreignObject><p>unsafe</p></foreignObject><animate attributeName="href" values="javascript:alert(1)"/><use href="https://outside.example/icon"/></svg>',
  };
  const visual = await buildVisual(page, [], 'svg');
  assert.match(visual.html, /<svg/);
  assert.match(visual.html, /<path/);
  assert.doesNotMatch(visual.html, /script|foreignObject|animate|outside.example/);
  assert.equal(visual.quality.status, 'incomplete');
});

test('Browser failure is explicit, deduplicated and saved as a fallback', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ghostapi-render-fallback-'));
  let attempts = 0;
  const page = {
    url: 'https://shop.example/',
    contentType: 'text/html',
    body: '<h1>Fallback page</h1>',
  };
  const sites = new Websites(
    dir,
    async () => page,
    undefined,
    async () => {
      attempts++;
      throw new Error('Browser unavailable');
    },
  );
  await sites.load();
  try {
    const id = await sites.inspect({ url: page.url });
    await sites.idle();
    const [first, second] = await Promise.all([sites.visual(id), sites.visual(id)]);
    assert.equal(attempts, 1);
    assert.equal(first.rendered?.mode, 'static-fallback');
    assert.equal(second.quality.status, 'incomplete');
    assert.match(first.notes.join(' '), /Browser capture failed/);
    await sites.visual(id);
    assert.equal(attempts, 1);
  } finally {
    await sites.close();
  }
});

test('Saved visual capture opens after restart without contacting the source', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ghostapi-visual-'));
  const page = {
    url: 'https://shop.example/book',
    contentType: 'text/html',
    body: '<h1>Book</h1><p class="price_color">£12</p>',
  };
  const first = new Websites(dir, async () => page);
  await first.load();
  const id = await first.inspect({ url: page.url });
  await first.idle();
  await first.visual(id);
  await first.close();
  const restored = new Websites(dir, async () => {
    throw new Error('No internet');
  });
  await restored.load();
  const visual = await restored.visual(id);
  assert.equal(visual.rea?.status, 'verified');
  assert.equal(visual.rea?.requests[0]?.kind, 'document');
  assert.equal(visual.bindings[0]?.rea_source?.evidence_id, visual.rea?.evidence_id);
  assert.equal(visual.bindings.length, 2);
  assert.match(restored.preview(id), /data-ghost-field/);
  await restored.close();
});

test('Real REA inspects sanitized clone reads and returns digest-bound normalized records', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ghostapi-clone-rea-'));
  const request = captureRequest(
    'https://name:password@shop.example/data?token=credential#secret',
    'application/json',
    '{"token":"private-body"}',
  );
  const evidence = await inspectCloneCapture([request], dir);
  assert.equal(evidence.status, 'verified');
  assert.ok(evidence.evidence_id);
  assert.match(evidence.sha256!, /^[a-f0-9]{64}$/);
  assert.deepEqual(evidence.requests, [
    { url: 'https://shop.example/data', method: 'GET', mime: 'application/json', kind: 'json' },
  ]);
  for (const file of await readdir(join(dir, 'captures'))) {
    const content = await readFile(join(dir, 'captures', file), 'utf8');
    assert.doesNotMatch(content, /credential|password|private-body|#secret/);
  }
});
