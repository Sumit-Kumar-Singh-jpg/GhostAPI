import { test, expect } from '@playwright/test';
import { startRuntime } from '../../src/server.js';
import { baseline } from '../../src/domain/policy.js';
import { installReadOnlyBridge, readBrowserQuote } from '../../src/integrations/browser.js';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('Simple home has one URL flow and no demo navigation', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Analyze website' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Demo overview' })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
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
