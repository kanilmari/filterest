import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './testing/visual_guardian',
  outputDir: './testing/test-results-visual',
  globalSetup: './testing/e2e/global-setup.ts',
  globalTeardown: './testing/e2e/global-teardown.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  // Chromium's setup state is intentionally rejected by Firefox's browser
  // fingerprint, so keep fallback logins below the local auth/load threshold.
  workers: process.env.CI ? 1 : 2,
  reporter: 'list',
  use: {
    // All tests and development use port 8082
    baseURL: 'https://localhost:8082',
    trace: 'on-first-retry',
    ignoreHTTPSErrors: true,
    storageState: './testing/e2e/.auth/user.json',
    extraHTTPHeaders: {
      'X-Bypass-Ratelimit': 'test-mode',
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // WebKit (WPE) requires system-level libwpe / libWPEWebKit that are
      // not available in standard Ubuntu repos.  Use Firefox (Gecko) as the
      // second browser engine for genuine cross-browser coverage instead.
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
  ],
});
