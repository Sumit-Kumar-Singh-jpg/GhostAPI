import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  timeout: 60000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4300',
    headless: true,
    channel: process.env.CI ? undefined : 'chrome',
    viewport: { width: 1440, height: 1050 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm start',
    url: 'http://127.0.0.1:4300/api/state',
    reuseExistingServer: false,
    env: { PORT: '4300', PORTAL_PORT: '4301', DATA_DIR: './data/e2e', HOST: '127.0.0.1' },
    timeout: 30000,
  },
});
