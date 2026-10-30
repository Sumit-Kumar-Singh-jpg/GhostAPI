import { test, expect } from '@playwright/test';
test('City verdict clearly distinguishes positive, negative, mixed and pending evidence', async ({
  page,
}) => {
  let outcomes = ['DELIVERABLE', 'DELIVERABLE'];
  let pending = false;
  let variant = '16 GB';
  await page.route('**/api/delivery-jobs', (route) =>
    route.fulfill({
      json: {
        jobs: outcomes.map((verdict, i) => ({
          id: `visual-${i}`,
          matrix_id: 'visual-matrix',
          input: { url: 'https://www.amazon.in/dp/B012345678', pincode: ['110001', '400001'][i] },
          status: pending && i === 1 ? 'running' : 'completed',
          started_at: new Date().toISOString(),
          progress: [],
          result: {
            verdict,
            checked_at: new Date().toISOString(),
            observation: {
              observed_pin: ['110001', '400001'][i],
              observed_variant: i ? variant : '16 GB',
              excerpt: 'Test fixture only',
            },
          },
        })),
      },
    }),
  );
  await page.goto('/shopping');
  const banner = page.locator('.delivery-verdict');
  await expect(banner).toHaveClass(/positive/);
  await expect(banner).toContainText('✓');
  await expect(banner).toHaveCSS('color', 'rgb(115, 211, 60)');
  outcomes = ['NOT_DELIVERABLE', 'NOT_DELIVERABLE'];
  await expect(banner).toHaveClass(/negative/);
  await expect(banner).toContainText('✕');
  await expect(banner).toHaveCSS('color', 'rgb(255, 69, 58)');
  outcomes = ['DELIVERABLE', 'NOT_DELIVERABLE'];
  await expect(banner).toHaveClass(/uncertain/);
  outcomes = ['DELIVERABLE', 'DELIVERABLE'];
  variant = '32 GB';
  await expect(banner).toHaveClass(/uncertain/);
  variant = '16 GB';
  pending = true;
  await expect(banner).toContainText('Checking delivery');
  await expect(banner).toHaveClass(/uncertain/);
  pending = false;
  outcomes = ['UNKNOWN', 'UNKNOWN'];
  await expect(banner).toContainText('Mixed or inconclusive');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
});
