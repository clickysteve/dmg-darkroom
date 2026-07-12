// Playwright config — e2e tests for the web build (docs/).
// Run: npm run test:e2e

const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: 'test/e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: 'http://localhost:8347',
    viewport: { width: 1280, height: 800 },
    chromiumSandbox: false,
    channel: 'chromium', // full chromium in new-headless mode (no headless_shell needed)
  },
  webServer: {
    command: 'node tools/serve.js 8347',
    url: 'http://localhost:8347',
    reuseExistingServer: !process.env.CI,
  },
});
