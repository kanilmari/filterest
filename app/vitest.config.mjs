// vitest.config.mjs
// Repo-root Vitest configuration for frontend unit tests.
// Bridges `npm test` / `npm run test:watch` and the browser-like jsdom harness.
// Exists to keep Playwright and Visual Guardian specs out of Vitest's file selection.

import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { createRequire } from 'node:module';

import { resolveVitestMaxWorkers } from './server_tools/scripts/vitest_process_config.mjs';
import { resolveFilterestTestRuntimeRoot } from './server_tools/scripts/test_runtime_paths.mjs';

// These Node-only test dependencies use bare ESM imports, which ignore NODE_PATH.
// Follow the installation-owned dependency loader's explicit root contract;
// do not create node_modules inside immutable app source.
export function resolveRuntimeTestAliases(environment = process.env) {
  const root = String(environment.FILTEREST_NODE_MODULES_ROOT || '').trim();
  if (!root) return [];
  if (!isAbsolute(root)) {
    throw new Error('FILTEREST_NODE_MODULES_ROOT must be an absolute path');
  }
  const runtimeRequire = createRequire(join(dirname(root), 'package.json'));
  return ['glob', '@playwright/test'].map((name) => ({
    find: name,
    replacement: runtimeRequire.resolve(name),
  }));
}

const frontendSourceRoot = [
  resolve('filterest/app/frontend'),
  resolve('frontend'),
].find((candidate) => existsSync(candidate)) || resolve('frontend');

export default {
  cacheDir: join(resolveFilterestTestRuntimeRoot(), 'vite-cache'),
  resolve: {
    alias: [
      ...resolveRuntimeTestAliases(),
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
