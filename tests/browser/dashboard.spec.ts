import { test, expect } from '@playwright/test';
import { startRuntime } from '../../src/server.js';
import { baseline } from '../../src/domain/policy.js';
import { installReadOnlyBridge, readBrowserQuote } from '../../src/integrations/browser.js';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { captureRenderedPage } from '../../src/websites/render.js';
import type { AgentRunWithStreamingResponse } from '@tiny-fish/sdk';

test('Inline TinyFish viewer stays mounted, switches PINs and clears ended sessions', async ({
  page,
}) => {
  let progress = 'Opening listing',
    ended = false,
    viewerLoads = 0;
  await page.route('https://tetra-streaming.tinyfish.io/**', (route) => {
    viewerLoads++;
    return route.fulfill({
      contentType: 'text/html',
      body: '<html><body>Fixture live browser<canvas width="640" height="400"></canvas></body></html>',
    });
  });
  await page.route('**/api/delivery-jobs', (route) =>
    route.fulfill({
      json: {
        jobs: ['560064', '110001'].map((pincode, index) => ({
          id: `live-${index}`,
          input: { url: 'https://www.amazon.in/dp/B012345678', pincode },
          status: ended ? 'completed' : 'running',
          started_at: new Date().toISOString(),
          progress: [progress],
          ...(ended ? {} : { live_url: `https://tetra-streaming.tinyfish.io/session-${index}` }),
        })),
      },
    }),
  );
  await page.goto('/shopping');
  await expect(
    page.frameLocator('#delivery-live-frame').getByText('Fixture live browser'),
  ).toBeVisible();
  expect(viewerLoads).toBe(1);
  progress = 'Reading delivery evidence';
  await expect(page.locator('.delivery-viewer')).toContainText(progress, { timeout: 8000 });
  expect(viewerLoads).toBe(1);
  await page.getByLabel('Active delivery check', { exact: true }).selectOption('live-1');
  await expect(page.locator('#delivery-live-frame')).toHaveAttribute(
    'title',
    'TinyFish live browser for PIN 110001',
  );
  await expect.poll(() => viewerLoads).toBe(2);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await page.screenshot({ path: 'artifacts/delivery-inline-fixture.png', fullPage: true });
  ended = true;
  await expect(page.locator('#delivery-live-frame')).toHaveCount(0, { timeout: 8000 });
  await expect(page.locator('.delivery-viewer')).toContainText('Live session ended');
  await expect(page.getByRole('link', { name: 'Open live browser separately' })).toBeHidden();
});

test('Reviewed delivery API monitors, validates a replacement and retires', async ({ browser }) => {
  const previous = process.env.TINYFISH_API_KEY;
  process.env.TINYFISH_API_KEY = 'fixture';
  let calls = 0;
  const runtime = await startRuntime({
    dashboardPort: 0,
    portalPort: 0,
    dataDir: await mkdtemp(join(tmpdir(), 'workflow-ui-')),
    deliveryClient: () => ({
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
                excerpt: 'Fixture delivery confirmation',
              },
            };
          })(),
      },
    }),
  });
  const page = await browser.newPage();
  try {
    await page.request.post(runtime.url + '/api/check-delivery', {
      headers: { 'X-GhostAPI-Client': 'dashboard' },
      data: { url: 'https://www.amazon.in/dp/B012345678', pincode: '560064' },
    });
    await page.goto(runtime.url + '/#shopping');
    await page.getByRole('button', { name: 'Review as API', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Publish local API', exact: true }),
    ).toBeDisabled();
    await page.getByRole('checkbox').filter({ visible: true }).check();
    await page.getByRole('button', { name: 'Publish local API', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Invoke fresh check', exact: true }),
    ).toBeVisible();
    await page.getByLabel('Delivery PIN for this API', { exact: true }).fill('560064');
    await page.getByLabel('Variant for this API', { exact: true }).fill('16 GB');
    const publishedState = await (
      await page.request.get(runtime.url + '/api/delivery-workflows')
    ).json();
    await page.request.post(
      runtime.url + `/api/delivery-workflows/${publishedState.workflows[0].id}/invoke`,
      { headers: { 'X-GhostAPI-Client': 'dashboard' }, data: { pincode: '560064' } },
    );
    await expect(page.getByText('Health: observed', { exact: true })).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByLabel('Delivery PIN for this API', { exact: true })).toHaveValue(
      '560064',
    );
    await expect(page.getByLabel('Variant for this API', { exact: true })).toHaveValue('16 GB');
    await expect(page.getByLabel('Variant for this API', { exact: true })).toBeFocused();
    await page.getByRole('button', { name: 'Invoke fresh check', exact: true }).click();
    await expect(page.locator('#delivery-results')).toContainText('Published API version 1', {
      timeout: 10000,
    });
    expect(calls).toBe(3);
    const workflows = await (
      await page.request.get(runtime.url + '/api/delivery-workflows')
    ).json();
    const docs = await (
      await page.request.get(
        runtime.url + `/api/delivery-workflows/${workflows.workflows[0].id}/openapi`,
      )
    ).json();
    expect(docs.openapi).toBe('3.1.0');
    await page.getByRole('button', { name: 'Monitor daily', exact: true }).click();
    await expect(page.locator('.monitor-card')).toContainText('Delivery 560064');
    await page
      .locator('.monitor-card')
      .getByRole('button', { name: 'Check now', exact: true })
      .click();
    await expect(page.locator('.monitor-card')).toContainText('unchanged');
    await page.getByRole('button', { name: 'Prepare replacement draft', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Validate replacement', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Validate replacement', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Validation finished' })).toBeVisible();
    await page.getByRole('checkbox').filter({ visible: true }).check();
    await page.getByRole('button', { name: 'Publish local API', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Delivery API · version 2 · published', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Delivery API · version 1 · retired', exact: true }),
    ).toBeVisible();
    await page
      .locator('.monitor-card')
      .getByRole('button', { name: 'Check now', exact: true })
      .click();
    await expect(page.locator('.monitor-card')).toContainText('retired or unavailable');
    await page.getByRole('button', { name: 'Retire API', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Invoke fresh check', exact: true })).toHaveCount(
      0,
    );
    await page.screenshot({ path: 'artifacts/delivery-workflow-ui.png', fullPage: true });
  } finally {
    await page.close();
    await runtime.close();
    if (previous === undefined) delete process.env.TINYFISH_API_KEY;
    else process.env.TINYFISH_API_KEY = previous;
  }
});

test('PIN matrix automatically includes city PINs and keeps mixed outcomes visible on mobile', async ({
  page,
}) => {
  let jobs: unknown[] = [];
  let submitted: unknown;
  await page.route('**/api/delivery-jobs', (route) => route.fulfill({ json: { jobs } }));
  await page.route('**/api/delivery-matrices', async (route) => {
    submitted = route.request().postDataJSON();
    jobs = ['560064', '110001', '400001'].map((pincode, i) => ({
      id: `matrix-${i}`,
      matrix_id: 'fixture-matrix',
      input: { url: 'https://www.amazon.in/dp/B012345678', pincode },
      status: i === 1 ? 'failed' : 'completed',
      started_at: new Date().toISOString(),
      progress: [],
      ...(i === 1
        ? { error: 'Fixture source unavailable' }
        : {
            result: {
              verdict: i === 0 ? 'DELIVERABLE' : 'NOT_DELIVERABLE',
              checked_at: new Date().toISOString(),
              observation: {
                observed_pin: pincode,
                observed_variant: '16 GB',
                excerpt: 'Fixture delivery evidence',
              },
            },
          }),
    }));
    await route.fulfill({ status: 202, json: { matrix_id: 'fixture-matrix' } });
  });
  await page.goto('/#shopping');
  await page.getByLabel('Product URL', { exact: true }).fill('https://www.amazon.in/dp/B012345678');
  await page.getByLabel('Delivery PIN', { exact: true }).fill('560064');
  await page.getByRole('button', { name: 'Check delivery', exact: true }).click();
  await expect(page.locator('#delivery-results table')).toContainText('DELIVERABLE');
  await expect(page.locator('#delivery-results table')).toContainText('failed');
  await expect(page.locator('#delivery-results table')).toContainText('NOT_DELIVERABLE');
  const request = submitted as { url: string; pincodes: string[] };
  expect(request.url).toBe('https://www.amazon.in/dp/B012345678');
  expect(request.pincodes).toHaveLength(60);
  expect(new Set(request.pincodes).size).toBe(60);
  expect(request.pincodes).toEqual(
    expect.arrayContaining(['560064', '110001', '400001', '682555']),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await page.screenshot({ path: 'artifacts/delivery-matrix-ui.png', fullPage: true });
});

test('Delivery UI shows progress, temporary viewing link and uncertain evidence', async ({
  page,
}) => {
  let done = false;
  await page.route('**/api/delivery-jobs', (route) =>
    route.fulfill({
      json: {
        jobs: [
          {
            id: 'fixture',
            input: { url: 'https://www.amazon.in/dp/B012345678', pincode: '560064' },
            started_at: new Date().toISOString(),
            status: done ? 'completed' : 'running',
            run_id: 'fixture-run',
            progress: ['Entered delivery PIN'],
            ...(done
              ? {
                  result: {
                    verdict: 'UNKNOWN',
                    checked_at: new Date().toISOString(),
                    observation: { delivery: 'unclear', excerpt: 'PIN could not be confirmed' },
                  },
                }
              : { live_url: 'https://example.com/temporary-view' }),
          },
        ],
      },
    }),
  );
  await page.goto('/#shopping');
  await expect(page.getByRole('link', { name: 'Open live browser separately' })).toHaveAttribute(
    'target',
    '_blank',
  );
  await expect(page.locator('#delivery-results')).toContainText('fixture-run');
  done = true;
  await expect(page.locator('#delivery-results')).toContainText('UNKNOWN', { timeout: 8000 });
  await expect(page.getByRole('button', { name: 'Watch in this page' })).toHaveCount(0);
  await expect(page.locator('#delivery-results')).toContainText('PIN could not be confirmed');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
});

test('Delivery form validates retailer scope and stays out of internship workflow', async ({
  page,
}) => {
  await page.goto('/#shopping');
  await page.getByLabel('Product URL', { exact: true }).fill('https://example.com/laptop');
  await page.getByLabel('Delivery PIN', { exact: true }).fill('560064');
  await page.getByRole('button', { name: 'Check delivery', exact: true }).click();
  await expect(page.locator('#delivery-message')).toContainText('Amazon India');
  await page.getByRole('link', { name: 'Internship Checker', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Check delivery', exact: true })).toBeHidden({
    timeout: 5000,
  });
});

test('Opt-in monitoring shows price changes, pauses and survives reload', async ({ browser }) => {
  let price = 999;
  const runtime = await startRuntime({
    dashboardPort: 0,
    portalPort: 0,
    dataDir: await mkdtemp(join(tmpdir(), 'ghostapi-monitors-ui-')),
    shoppingProvider: {
      search: async () => [{ url: 'https://shop.example/item', title: 'Item' }],
      fetch: async (urls) =>
        urls.map((url) => ({
          url,
          html: `<h1>Item</h1><script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name: 'Item', offers: { price, priceCurrency: 'INR', availability: 'https://schema.org/InStock' } })}</script>`,
        })),
    },
  });
  const page = await browser.newPage();
  try {
    await page.goto(runtime.url + '/#shopping');
    await page.getByLabel('Product name or details', { exact: true }).fill('Example item');
    await page.getByRole('button', { name: 'Check online', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Monitor daily', exact: true })).toBeVisible({
      timeout: 15000,
    });
    await page.getByRole('button', { name: 'Monitor daily', exact: true }).click();
    await expect(page.locator('.monitor-card')).toContainText('Enabled');
    price = 899;
    await page
      .locator('.monitor-card')
      .getByRole('button', { name: 'Check now', exact: true })
      .click();
    await expect(page.locator('.monitor-card')).toContainText('changed', { timeout: 15000 });
    await page.locator('.monitor-card summary').click();
    await expect(page.locator('.monitor-card')).toContainText('999 → 899');
    await page.locator('.monitor-card').getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(page.locator('.monitor-card')).toContainText('Paused');
    await page.screenshot({ path: 'artifacts/phase6-monitoring.png', fullPage: true });
    await page.reload();
    await page.locator('#scheduled-checks > summary').click();
    await expect(page.locator('.monitor-card')).toContainText('Paused');
    const rejected = await page.request.post(runtime.url + '/api/monitors', {
      headers: { 'X-GhostAPI-Client': 'dashboard', Origin: 'https://outside.invalid' },
      data: { action: 'create', target: { kind: 'shopping', request_id: 'unknown' } },
    });
    expect(rejected.status()).toBe(403);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();
  } finally {
    await page.close();
    await runtime.close();
  }
});

test('Internship checks show sourced warnings and preserve cached results', async ({ browser }) => {
  const runtime = await startRuntime({
    dashboardPort: 0,
    portalPort: 0,
    dataDir: await mkdtemp(join(tmpdir(), 'ghostapi-internship-ui-')),
    internshipProvider: {
      search: async () => [],
      fetch: async (urls) =>
        urls.map((url) => ({
          url,
          html: url.includes('jobs.example')
            ? '<h1>Engineering internship</h1><p>Please pay a registration fee of INR 500.</p>'
            : '<h1>Company careers</h1><a href="https://jobs.example/role">Engineering internship</a>',
        })),
    },
  });
  const page = await browser.newPage();
  try {
    await page.goto(runtime.url + '/#internships');
    await page
      .getByLabel('Internship link or description', { exact: true })
      .fill('https://jobs.example/role');
    await page
      .getByLabel('Company website (optional)', { exact: true })
      .fill('https://company.example/');
    await page.getByRole('button', { name: 'Check online', exact: true }).click();
    await expect(page.locator('.internship-assessment')).toHaveText('Strong warning signs', {
      timeout: 15000,
    });
    await expect(page.locator('#research-list')).toContainText('Upfront payment request');
    await expect(page.locator('#research-list')).toContainText(
      'Reference site links to this opportunity',
    );
    await expect(page.locator('#research-list')).toContainText('not a safe/fraud verdict');
    await page.getByRole('button', { name: 'Use recent result', exact: true }).click();
    await expect(page.locator('#research-message')).toContainText('cached result');
    await page.screenshot({ path: 'artifacts/phase5-internships.png', fullPage: true });
    await page.reload();
    await expect(page.locator('.internship-assessment')).toHaveText('Strong warning signs');
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();
  } finally {
    await page.close();
    await runtime.close();
  }
});

test('Shopping checks show sourced facts, cached results and a monitoring handoff', async ({
  browser,
}) => {
  let fetches = 0;
  const runtime = await startRuntime({
    dashboardPort: 0,
    portalPort: 0,
    dataDir: await mkdtemp(join(tmpdir(), 'ghostapi-shopping-ui-')),
    shoppingProvider: {
      search: async () => [{ url: 'https://shop.example/headphones', title: 'Headphones' }],
      fetch: async (urls) => {
        fetches++;
        return urls.map((url) => ({
          url,
          html: '<h1>Test headphones</h1><script type="application/ld+json">{"@type":"Product","name":"Test headphones","model":"H100","offers":{"price":999,"priceCurrency":"INR","availability":"https://schema.org/InStock"}}</script>',
        }));
      },
    },
  });
  const page = await browser.newPage();
  try {
    await page.goto(runtime.url + '/#shopping');
    await page.getByLabel('Product name or details', { exact: true }).fill('Test headphones H100');
    await page.getByRole('button', { name: 'Check online', exact: true }).click();
    await expect(page.locator('.shopping-listing')).toContainText('Test headphones', {
      timeout: 15000,
    });
    await expect(page.locator('.shopping-listing')).toContainText('INR');
    await expect(page.locator('.shopping-listing')).toContainText('Product.offers.price');
    await expect(page.locator('.shopping-listing')).toContainText(
      'authenticity have not been verified',
    );
    await page.getByRole('button', { name: 'Use recent result', exact: true }).click();
    await expect(page.locator('#research-message')).toContainText('cached result');
    expect(fetches).toBe(1);
    await page.screenshot({ path: 'artifacts/phase4-shopping.png', fullPage: true });
    await page.reload();
    await expect(page.locator('.shopping-listing')).toContainText('Test headphones');
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();
    await page.getByRole('button', { name: 'Set up monitoring', exact: true }).click();
    await expect(page.getByLabel('Public website URL')).toHaveValue(
      'https://shop.example/headphones',
    );
    await expect(page.locator('#website-form-message')).toContainText('approve the fields');
  } finally {
    await page.close();
    await runtime.close();
  }
});

test('Pagination capture maps a source API, replays it, then withholds changed data', async ({
  browser,
}) => {
  let title = 'Second product';
  const reader = async (url: string) =>
    url.includes('/api/products')
      ? { url, contentType: 'application/json', body: JSON.stringify({ title }) }
      : {
          url,
          contentType: 'text/html',
          body: '<!doctype html><html><body><h1>Catalog</h1><p id="product">First product</p><button id="next">Next</button><script>document.querySelector("#next").onclick=async()=>{const data=await(await fetch("/api/products?page=2")).json();document.querySelector("#product").textContent=data.title;};</script></body></html>',
        };
  const runtime = await startRuntime({
    dashboardPort: 0,
    portalPort: 0,
    dataDir: await mkdtemp(join(tmpdir(), 'ghostapi-source-ui-')),
    websiteReader: reader,
    websiteRenderer: (url) => captureRenderedPage(url, reader),
    interactionCapture: (url, control) => captureRenderedPage(url, reader, control),
  });
  const page = await browser.newPage();
  try {
    await page.goto(runtime.url + '/website-builder');
    await page.getByLabel('Public website URL').fill('https://fixture.example/');
    await page.getByRole('button', { name: 'Analyze website' }).click();
    await expect(page.locator('#visual-frame')).toBeVisible({ timeout: 45000 });
    await page
      .frameLocator('#visual-frame')
      .getByRole('button', { name: 'Next', exact: true })
      .click();
    await expect(page.locator('#interaction-control')).toHaveValue('page-0');
    await page.getByRole('button', { name: 'Capture interaction', exact: true }).click();
    await expect(page.locator('#interaction-results')).toContainText('Verified field mapping', {
      timeout: 45000,
    });
    await expect(page.locator('#interaction-results')).toContainText('/api/products?page=2');
    await page.getByRole('button', { name: 'Test source API', exact: true }).click();
    await expect(page.locator('#interaction-output')).toContainText('Second product');
    await page.screenshot({ path: 'artifacts/phase3-workspace.png', fullPage: true });
    title = 'Changed product';
    await page.getByRole('button', { name: 'Test source API', exact: true }).click();
    await expect(page.locator('#interaction-results')).toContainText('Needs a fresh capture');
    await expect(page.getByRole('button', { name: 'Test source API', exact: true })).toBeDisabled();
    await expect(page.locator('#interaction-output')).toBeHidden();
    await page.reload();
    await expect(page.locator('#interaction-results')).toContainText('Needs a fresh capture', {
      timeout: 15000,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();
  } finally {
    await page.close();
    await runtime.close();
  }
});

test('Rendered capture exposes source comparison and a script-free preview', async ({
  browser,
}) => {
  const source = {
    url: 'https://fixture.example/',
    contentType: 'text/html',
    body: '<!doctype html><html><head><style>body{background:#123;color:white}h1{font-size:32px}</style></head><body><h1>Product</h1><p id="loaded"></p><script>document.querySelector("#loaded").textContent="Added by JavaScript"</script></body></html>',
  };
  const runtime = await startRuntime({
    dashboardPort: 0,
    portalPort: 0,
    dataDir: await mkdtemp(join(tmpdir(), 'ghostapi-render-ui-')),
    websiteReader: async () => source,
    websiteRenderer: (url) => captureRenderedPage(url, async () => source),
  });
  const page = await browser.newPage();
  try {
    await page.goto(runtime.url + '/website-builder');
    await page.getByLabel('Public website URL').fill(source.url);
    await page.getByRole('button', { name: 'Analyze website' }).click();
    await expect(page.locator('#visual-frame')).toBeVisible({ timeout: 45000 });
    await expect(page.locator('#visual-quality')).toContainText('Rendered browser capture');
    await page.getByText('Compare captured page and preview', { exact: true }).click();
    await expect(page.locator('#visual-source-shot')).toBeVisible();
    await expect(page.locator('#visual-preview-shot')).toBeVisible();
    await expect(page.frameLocator('#visual-frame').locator('#loaded')).toHaveText(
      'Added by JavaScript',
    );
    await expect(page.frameLocator('#visual-frame').locator('script')).toHaveCount(0);
    await page.screenshot({ path: 'artifacts/phase2-workspace.png', fullPage: true });
  } finally {
    await page.close();
    await runtime.close();
  }
});

test('Motion homepage plays local MP4 and tools navigate to separate pages', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('video source')).toHaveAttribute('type', 'video/mp4');
  await expect
    .poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.readyState))
    .toBeGreaterThanOrEqual(2);
  await page.screenshot({ path: 'artifacts/motion-home-desktop.png' });
  await page.getByRole('link', { name: 'Website Builder', exact: true }).click();
  await expect(page).toHaveURL(/\/website-builder$/);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Analyze website' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Demo overview' })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('.hero-copy')).toHaveCSS('opacity', '1');
  await page.screenshot({ path: 'artifacts/motion-home-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Open menu', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Internship Checker', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Open menu', exact: true })).toBeFocused();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect
    .poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.paused))
    .toBe(true);
});

test('Shopping and internship requests save locally with honest status and mobile navigation', async ({
  page,
}) => {
  await page.goto('/website-builder');
  await page.getByRole('link', { name: 'Shopping Assistant', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Analyze website' })).not.toBeVisible();
  const product = `Headphones ${Date.now()}`;
  await page.getByLabel('Product name or details', { exact: true }).fill(product);
  await page.getByRole('button', { name: 'Save request', exact: true }).click();
  await expect(page.locator('#research-message')).toHaveText(
    'Saved locally. No online check has been run.',
  );
  await page.reload();
  await expect(page.locator('#research-list')).toContainText(product);
  await expect(page.locator('#research-list')).toContainText('Not checked yet');
  await page.getByRole('link', { name: 'Internship Checker', exact: true }).click();
  await page
    .getByLabel('Internship link or description', { exact: true })
    .fill('Example internship asking for an application fee.');
  await page.getByRole('button', { name: 'Save request', exact: true }).click();
  await expect(page.locator('#research-message')).toContainText('Saved locally');
  await expect(page.locator('#research-list')).not.toContainText(product);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await page.getByRole('link', { name: 'Website Builder', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Analyze website' })).toBeVisible();
});
test('Browser bridge reads the real portal and prevents unenrolled navigation before the request', async ({
  browser,
  request,
}) => {
  await request.post('/api/reset', { headers: { 'X-GhostAPI-Client': 'dashboard' }, data: {} });
  const state = await (await request.get('/api/state')).json();
  const workflow = baseline(state.portal_origin);
  const context = await browser.newContext({
    javaScriptEnabled: false,
    serviceWorkers: 'block',
    acceptDownloads: false,
  });
  try {
    const guard = await installReadOnlyBridge(
      context,
      workflow,
      { sku: 'MOTOR-01', quantity: 1 },
      10000,
    );
    const page = await context.newPage();
    const result = await readBrowserQuote(
      page,
      workflow,
      { sku: 'MOTOR-01', quantity: 1 },
      10000,
      'local-browser-policy-test',
    );
    expect(result.observation.reported_total_paise).toBe(118000);
    await expect(page.goto('https://outside.invalid/write', { timeout: 3000 })).rejects.toThrow();
    expect(guard.denied()).toBeGreaterThan(0);
  } finally {
    await context.close();
  }
});

test('Protected workspace shows a working sign-in and sign-out flow', async ({ browser }) => {
  const runtime = await startRuntime({
    dashboardPort: 0,
    portalPort: 0,
    dataDir: await mkdtemp(join(tmpdir(), 'ghostapi-browser-auth-')),
    adminPassword: 'browser-test-fixture-password',
  });
  const page = await browser.newPage();
  try {
    await page.goto(runtime.url + '/website-builder');
    await expect(page.locator('#login-dialog')).toBeVisible();
    await page
      .getByLabel('Administrator password', { exact: true })
      .fill('browser-test-fixture-password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.locator('#login-dialog')).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Analyze website', exact: false })).toBeEnabled();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.locator('#login-dialog')).toBeVisible();
  } finally {
    await page.close();
    await runtime.close();
  }
});

test('Website onboarding discovers fields, monitors values, reviews a repair and exposes JSON', async ({
  browser,
}) => {
  let price = '£10.00',
    selector = 'price_color';
  const runtime = await startRuntime({
    dashboardPort: 0,
    portalPort: 0,
    dataDir: await mkdtemp(join(tmpdir(), 'ghostapi-websites-browser-')),
    websiteReader: async (url) => ({
      url,
      contentType: 'text/html',
      body: `<h1>Example book</h1><p class="${selector}">${price}</p><p class="availability">In stock</p>`,
    }),
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(runtime.url + '/website-builder');
    await page.getByLabel('Public website URL').fill('https://shop.example/book');
    await page.getByText('Optional details', { exact: true }).click();
    await page.getByLabel('Workflow name').fill('Example book monitor');
    await page.getByRole('button', { name: 'Analyze website', exact: false }).click();
    await expect(page.getByText('Review the extraction contract', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Approve contract & monitor' }).click();
    await expect(page.locator('.website-values')).toContainText('£10.00');
    await expect(page.locator('#visual-frame')).toBeVisible({ timeout: 35000 });
    await expect(page.locator('#visual-rea')).toContainText('Verified · 1 HTTP records');
    await expect(page.locator('#visual-rea')).toContainText('not browser/CDP traffic');
    await page.locator('#visual-bindings [data-field-key="price"]').click();
    await page.getByRole('button', { name: 'Test API', exact: true }).click();
    await expect(page.locator('#visual-response')).toContainText('"http_status": 200');
    await expect(page.locator('#visual-response')).toContainText('£10.00');
    await page.frameLocator('#visual-frame').locator('[data-ghost-field="title"]').click();
    await expect(page.locator('#visual-field-label')).toHaveText('Title');
    const fieldResponse = await page.request.get(
      runtime.url +
        '/api/websites/' +
        (await page.locator('[data-website]').getAttribute('data-website')) +
        '/fields/not-approved',
    );
    expect(fieldResponse.status()).toBe(409);
    price = '£12.00';
    await page.getByRole('button', { name: 'Check now', exact: true }).click();
    await expect(page.locator('.website-status')).toHaveText('changed');
    selector = 'product-price';
    await page.getByRole('button', { name: 'Check now', exact: true }).click();
    await expect(page.getByText('Repair proposal ready', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Verify & apply repair' }).click();
    await expect(page.locator('.website-check-meta')).toContainText('Contract v2');
    await expect(page.locator('.website-status')).toHaveText('healthy');
    const endpoint = await page
      .getByRole('link', { name: 'Open JSON API', exact: false })
      .getAttribute('href');
    const data = await (await page.request.get(runtime.url + endpoint)).json();
    expect(data.data.price).toBe('£12.00');
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(page.locator('.website-check-meta')).toContainText('Monitoring paused');
    await page.screenshot({ path: 'artifacts/websites-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
    await page.screenshot({ path: 'artifacts/websites-mobile.png', fullPage: true });
    expect(errors).toEqual([]);
  } finally {
    await page.close();
    await runtime.close();
  }
});
