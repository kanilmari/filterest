// vitest.config.mjs
// Repo-root Vitest configuration for frontend unit tests.
// Bridges `npm test` / `npm run test:watch` and the browser-like jsdom harness.
// Exists to keep Playwright and Visual Guardian specs out of Vitest's file selection.

import { defineConfig } from 'vitest/config';

import { resolveVitestMaxWorkers } from './server_tools/scripts/vitest_process_config.mjs';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: [
      'frontend/**/*.test.js',
      'server_tools/lib/**/*.test.mjs',
      'server_tools/scripts/vitest_process_runner.test.mjs',
      'testing/e2e/helpers/**/*.test.ts',
    ],
    exclude: ['frontend/dist/**'],
    maxWorkers: resolveVitestMaxWorkers(),
  },
});
