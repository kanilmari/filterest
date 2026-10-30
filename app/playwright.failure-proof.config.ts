// playwright.failure-proof.config.ts
// Explicit manual entrypoint for T17b, following T18's separate-config isolation.
// Keeps deliberate failure/timeout cases out of every default matrix selection.
import { defineConfig } from '@playwright/test';
import * as path from 'node:path';
import matrix from './playwright.config';
import { resolveFilterestTestRuntimePaths } from './testing/e2e/helpers/test-runtime-paths';

if (process.env.CI) throw new Error('T17b requires a manual native run outside CI/nightly.');
const enabled = !!process.env.FILTEREST_E2E_FAILURE_PROOF_TARGET;
export default defineConfig({
  ...matrix,
  testMatch: 'T_admin/T17b_cleanup_after_failure.spec.ts',
  testIgnore: [],
  fullyParallel: false, workers: 1, retries: 0, forbidOnly: true,
  reporter: 'list',
  outputDir: path.join(resolveFilterestTestRuntimePaths().playwrightResults, 'failure-proof'),
  globalSetup: enabled ? matrix.globalSetup : undefined,
  globalTeardown: enabled ? matrix.globalTeardown : undefined,
  use: { ...matrix.use, trace: 'off' },
  projects: [{ name: 'desktop-card', use: { viewport: { width: 1440, height: 900 } },
    metadata: { cardView: 'normal', screenWidth: 'desktop' } }],
});
