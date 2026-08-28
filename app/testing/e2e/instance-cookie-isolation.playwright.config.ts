// instance-cookie-isolation.playwright.config.ts
// Runs the self-contained same-host, multi-port authentication-cookie proof.
// This separate config avoids the normal database-backed global login setup.
import { defineConfig } from '@playwright/test';
import * as path from 'node:path';
import { resolveFilterestTestRuntimePaths } from './helpers/test-runtime-paths';

const testRuntimePaths = resolveFilterestTestRuntimePaths();

export default defineConfig({
  testDir: '.',
  testMatch: ['L_auth/L4_instance_cookie_isolation.test.ts'],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'line',
  outputDir: path.join(testRuntimePaths.playwrightResults, 'instance-cookie-isolation'),
  use: {
    storageState: { cookies: [], origins: [] },
    trace: 'retain-on-failure',
  },
});
