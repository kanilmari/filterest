// playwright.custom-root.config.ts
// Runs K378's operator-fixture proof only through this explicit native config.
// Connects a local HTTPS target, isolated admin login state and the manual spec.
// Uses one worker, no retries, no trace and the standard test timeout.
import { defineConfig } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveLocalFilterestBaseUrl } from './server_tools/scripts/local_filterest_target.cjs';
import { resolveFilterestTestRuntimePaths } from './testing/e2e/helpers/test-runtime-paths';

const fixture = process.env.FILTEREST_E2E_CUSTOM_ROOT_FIXTURE;
if (process.env.CI) throw new Error('K378 requires an explicit manual native run outside CI/nightly.');
if (!fixture || !path.isAbsolute(fixture) || path.basename(fixture) !== 'site_root') {
  throw new Error('Set FILTEREST_E2E_CUSTOM_ROOT_FIXTURE to the absolute placed site_root directory.');
}
if (!fs.statSync(path.join(fixture, 'index.html')).isFile()) throw new Error('K378 fixture index.html is absent.');
const runtime = resolveFilterestTestRuntimePaths();

export default defineConfig({
  testDir: './testing/e2e',
  testMatch: 'T_admin/T18_custom_root_page.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  reporter: 'list',
  outputDir: path.join(runtime.playwrightResults, 'custom-root'),
  globalSetup: './testing/e2e/T_admin/custom_root_setup.ts',
  use: {
    baseURL: resolveLocalFilterestBaseUrl({ applicationRoot: __dirname }),
    storageState: path.join(runtime.authDirectory, 'custom-root-user.json'),
    viewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: true,
    trace: 'off',
    extraHTTPHeaders: { 'X-Bypass-Ratelimit': 'test-mode' },
  },
  projects: [{ name: 'custom-root-native', use: { browserName: 'chromium' } }],
});
