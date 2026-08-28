// playwright.visual.config.ts
// Configures Filterest's focused visual Playwright test project.
// Bridges visual specifications with the selected local Filterest target and runtime state.
// Exists so visual regressions can be checked without Easelect-specific dependencies.
import { defineConfig, devices } from '@playwright/test';
import * as path from 'node:path';
import { resolveLocalFilterestBaseUrl } from './server_tools/scripts/local_filterest_target.cjs';
import { resolveFilterestTestRuntimePaths } from './testing/e2e/helpers/test-runtime-paths';

const testRuntimePaths = resolveFilterestTestRuntimePaths();
const baseURL = resolveLocalFilterestBaseUrl({ applicationRoot: path.resolve(__dirname) });

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
    baseURL,
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
