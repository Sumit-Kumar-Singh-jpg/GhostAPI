import test from 'node:test';
import assert from 'node:assert/strict';
import { captureRenderedPage, screenshotPreview } from '../src/websites/render.js';
import { buildVisual } from '../src/websites/visual.js';
import { inspectPage } from '../src/websites/inspect.js';

test('Rendered capture preserves scripted and lazy content, freezes layout and blocks writes', async () => {
  const fetched: string[] = [];
  const captured = await captureRenderedPage('https://fixture.example/', async (url) => {
    fetched.push(url);
    if (url === 'https://fixture.example/')
      return {
        url,
        contentType: 'text/html',
        body: `<!doctype html><html><head><link rel="stylesheet" href="/style.css"></head><body><h1>Loading</h1><div id="lazy">Waiting</div><script src="/app.js"></script></body></html>`,
      };
    if (url.endsWith('/style.css'))
      return {
        url,
        contentType: 'text/css',
        body: 'body{margin:0;background:rgb(20,30,40);color:white;font-family:Arial}h1{font-size:32px;padding:30px;margin:0}#lazy{margin-top:1000px;color:lime}',
      };
    if (url.endsWith('/app.js'))
      return {
        url,
        contentType: 'application/javascript',
        body: `document.querySelector('h1').textContent='Rendered product £25';addEventListener('scroll',()=>document.querySelector('#lazy').textContent='Lazy content loaded');fetch('/purchase',{method:'POST'}).catch(()=>{});`,
      };
    throw new Error('Unexpected request');
  });
  assert.match(captured.page.body, /Rendered product £25/);
  assert.match(captured.page.body, /Lazy content loaded/);
  assert.ok(!fetched.some((url) => url.endsWith('/purchase')));
  assert.ok(captured.requests.some((request) => request.mime === 'application/javascript'));
  const visual = await buildVisual(
    captured.page,
    inspectPage(captured.page).fields,
    'fixture',
    async (url) => {
      const asset = captured.assets.get(url);
      if (!asset) throw new Error('Asset unavailable');
      return asset;
    },
  );
  assert.doesNotMatch(visual.html, /<script|src="\/app.js"/);
  assert.match(visual.html, /rgb\(20, 30, 40\)/);
  const preview = await screenshotPreview(visual.html);
  const png = Buffer.from(preview.split(',')[1]!, 'base64');
  assert.equal(png.readUInt32BE(16), 1280);
  assert.equal(png.readUInt32BE(20), 800);
  assert.equal(
    preview,
    captured.screenshot,
    'Supported fixture must reproduce the source viewport exactly',
  );
});
