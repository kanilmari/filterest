import { defineConfig, devices } from '@playwright/test';
import { resolveFilterestTestRuntimePaths } from './testing/e2e/helpers/test-runtime-paths';

const testRuntimePaths = resolveFilterestTestRuntimePaths();

export default defineConfig({
  testDir: './testing/visual_guardian',
  outputDir: testRuntimePaths.visualResults,
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
    storageState: testRuntimePaths.authStorageState,
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
