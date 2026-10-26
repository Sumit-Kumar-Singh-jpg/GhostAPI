import { test, expect } from '@playwright/test';
import { startRuntime } from '../../src/server.js';
import { baseline } from '../../src/domain/policy.js';
import { installReadOnlyBridge, readBrowserQuote } from '../../src/integrations/browser.js';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('Judges can follow the complete local recovery and incompatible rollback', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Keep your workflows correct.' })).toBeVisible();
  await page.getByRole('button', { name: 'Run local demo' }).click();
  await expect(page.locator('#health-value')).toHaveText('Healthy', { timeout: 45000 });
  await expect(page.locator('#quote-result')).toContainText('₹1,180.00');
  await expect(page.locator('#planner-label')).toContainText('RULES FALLBACK');
  await expect(page.locator('#timeline')).toContainText('Verified workflow published');
  await page.getByRole('button', { name: 'Run history' }).click();
  await expect(page.locator('#runs-list')).toContainText('WITHHELD');
  await page.locator('[data-run]').first().click();
  await expect(page.locator('#detail-dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Close details' }).click();
  await page.getByRole('button', { name: 'Evidence', exact: true }).click();
  await expect(page.locator('#evidence-list')).toContainText('REA · supplied capture inspection');
  await page.getByRole('button', { name: 'Workflow versions' }).click();
  await page.getByRole('button', { name: 'Restore previous active version' }).click();
  await expect(page.locator('#health-value')).toHaveText('Degraded');
  await page.getByRole('button', { name: 'Overview', exact: false }).click();
  await expect(page.locator('#quote-badge')).toHaveText('WITHHELD');
  expect(errors).toEqual([]);
});

test('Mobile layout stays within viewport and keeps controls usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Read current quotation' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: 'artifacts/dashboard-mobile.png', fullPage: true });
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
    await expect(page.getByRole('button', { name: 'Run local demo' })).toBeEnabled();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.locator('#login-dialog')).toBeVisible();
  } finally {
    await page.close();
    await runtime.close();
  }
});
