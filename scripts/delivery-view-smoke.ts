import 'dotenv/config';
import { startRuntime } from '../src/server.js';
import { chromium } from 'playwright-core';
import { mkdir, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const runtime = await startRuntime({
  dashboardPort: 0,
  portalPort: 0,
  dataDir: await mkdtemp(join(tmpdir(), 'ghostapi-live-view-')),
});
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
let frameStatus: number | undefined,
  frameRestriction = false;
page.on('response', (response) => {
  try {
    if (
      response.request().resourceType() === 'document' &&
      (new URL(response.url()).hostname.endsWith('.tetra-data.production.tinyfish.io') ||
        new URL(response.url()).hostname === 'tetra-streaming.tinyfish.io')
    ) {
      frameStatus = response.status();
      frameRestriction =
        !!response.headers()['x-frame-options'] ||
        !!response.headers()['content-security-policy']?.includes('frame-ancestors');
    }
  } catch {}
});
try {
  await page.goto(runtime.url + '/shopping');
  const response = await page.request.post(runtime.url + '/api/check-delivery', {
    headers: { 'X-GhostAPI-Client': 'dashboard' },
    data: { url: 'https://www.amazon.in/dp/B0HP21TZYH', pincode: '560064' },
  });
  if (response.status() !== 202) throw new Error('Delivery start rejected.');
  const accepted = await response.json();
  let captured = false,
    canvas = 0,
    summary;
  while (true) {
    const job = await (await page.request.get(runtime.url + accepted.status_url)).json();
    if (!captured && frameStatus === 200) {
      const frame = page
        .frames()
        .find(
          (frame) =>
            frame.url().includes('.tetra-data.production.tinyfish.io') ||
            frame.url().startsWith('https://tetra-streaming.tinyfish.io/'),
        );
      canvas = frame ? await frame.locator('canvas').count() : 0;
      if (canvas) {
        await mkdir('artifacts', { recursive: true });
        await page
          .locator('.delivery-viewer')
          .screenshot({ path: 'artifacts/delivery-inline-live.png' });
        captured = true;
      }
    }
    if (!['queued', 'running'].includes(job.status)) {
      summary = {
        status: job.status,
        verdict: job.result?.verdict,
        run_id: job.run_id,
        frame_status: frameStatus,
        frame_restriction_header: frameRestriction,
        canvas_count: canvas,
        screenshot_captured: captured,
      };
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  await mkdir('artifacts', { recursive: true });
  await writeFile('artifacts/delivery-inline-live.json', JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary));
} finally {
  await page.close();
  await browser.close();
  await runtime.close();
}
