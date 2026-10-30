import 'dotenv/config';
import { TinyFish } from '@tiny-fish/sdk';
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
const client = new TinyFish({ maxRetries: 0 });
try {
  const response = await fetch('http://127.0.0.1:3000/api/delivery-jobs');
  if (!response.ok) throw new Error('Local API unavailable or requires sign-in.');
  const data = await response.json();
  const job = data.jobs.find((job: { run_id?: string }) => job.run_id);
  if (!job) throw new Error('No provider run to inspect.');
  const recent = await client.runs.list({ limit: 1 });
  const run = recent.data[0] ?? (await client.runs.get(job.run_id));
  if (!run.streaming_url) throw new Error('Provider returned no viewer URL.');
  const result = await fetch(run.streaming_url);
  console.log(
    JSON.stringify({
      run_status: run.status,
      viewer_host: new URL(run.streaming_url).host,
      final_host: new URL(result.url).host,
      protocol: new URL(result.url).protocol,
      status: result.status,
      x_frame_options: result.headers.get('x-frame-options'),
      csp: result.headers.get('content-security-policy'),
    }),
  );
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error' && /Framing|frame-src|Refused to frame/i.test(msg.text()))
      console.log(msg.text().replace(/https?:\/\/[^\s"']+/g, '[URL withheld]'));
  });
  await page.route('**/api/delivery-jobs', (route) =>
    route.fulfill({
      json: {
        jobs: [
          {
            ...job,
            input: {
              ...job.input,
              pincode: run.goal.match(/Requested PIN: (\d+)/)?.[1] ?? job.input.pincode,
            },
            status: 'running',
            live_url: run.streaming_url,
          },
        ],
      },
    }),
  );
  await page.goto('http://127.0.0.1:3000/shopping');
  await page.locator('#delivery-live-frame').waitFor({ timeout: 8000 });
  await page.waitForTimeout(5000);
  await mkdir('artifacts', { recursive: true });
  await page
    .locator('.delivery-viewer')
    .screenshot({ path: 'artifacts/delivery-viewer-fixed.png' });
  console.log(
    JSON.stringify({
      frame_urls: page.frames().map((frame) => {
        try {
          return new URL(frame.url()).origin;
        } catch {
          return 'empty';
        }
      }),
    }),
  );
  await browser.close();
} catch (error) {
  console.log(
    JSON.stringify({
      error:
        error instanceof Error
          ? error.message.replace(/https?:\/\/\S+/g, '[URL withheld]')
          : 'unknown',
      status:
        typeof error === 'object' && error && 'statusCode' in error ? error.statusCode : undefined,
    }),
  );
  process.exitCode = 1;
}
