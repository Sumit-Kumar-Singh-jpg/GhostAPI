import { test, expect } from '@playwright/test';
import { startRuntime } from '../../src/server.js';
import { baseline } from '../../src/domain/policy.js';
import { installReadOnlyBridge, readBrowserQuote } from '../../src/integrations/browser.js';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { captureRenderedPage } from '../../src/websites/render.js';

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
    await page.goto(runtime.url);
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
    await page.goto(runtime.url);
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

test('Simple home has one URL flow and no demo navigation', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Analyze website' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Demo overview' })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
});

test('Shopping and internship requests save locally with honest status and mobile navigation', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Shopping Assistant', exact: true }).click();
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
  await page.getByRole('button', { name: 'Internship Checker', exact: true }).click();
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
  await page.getByRole('button', { name: 'Website Builder', exact: true }).click();
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
    await page.goto(runtime.url);
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
    await page.goto(runtime.url);
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
