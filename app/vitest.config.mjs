// vitest.config.mjs
// Repo-root Vitest configuration for frontend unit tests.
// Bridges `npm test` / `npm run test:watch` and the browser-like jsdom harness.
// Exists to keep Playwright and Visual Guardian specs out of Vitest's file selection.

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { resolveVitestMaxWorkers } from './server_tools/scripts/vitest_process_config.mjs';
import { resolveFilterestTestRuntimeRoot } from './server_tools/scripts/test_runtime_paths.mjs';

const frontendSourceRoot = [
  resolve('filterest/app/frontend'),
  resolve('frontend'),
].find((candidate) => existsSync(candidate)) || resolve('frontend');

export default {
  cacheDir: join(resolveFilterestTestRuntimeRoot(), 'vite-cache'),
  resolve: {
    alias: [
      {
        find: /^\/frontend\/(?!private_tools\/)/,
        replacement: `${frontendSourceRoot}/`,
      },
    ],
  },
  test: {
    environment: 'jsdom',
    include: [
      '**/frontend/**/*.test.js',
      '**/server_tools/lib/**/*.test.mjs',
      '**/server_tools/scripts/vitest_process_runner.test.mjs',
      'testing/e2e/helpers/**/*.test.ts',
    ],
    // Outer Easelect keeps ignored generated Filterest candidates under
    // dist-public/. They are release artifacts, not additional test roots.
    exclude: ['**/frontend/dist/**', '**/dist-public/**'],
    maxWorkers: resolveVitestMaxWorkers(),
  },
};
