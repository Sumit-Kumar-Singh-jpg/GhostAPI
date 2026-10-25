import { test, expect } from '@playwright/test';

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
