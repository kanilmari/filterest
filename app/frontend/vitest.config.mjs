// vitest.config.mjs
// Frontend-local Vitest configuration for direct frontend unit-test runs.
// Bridges cwd=frontend developer runs and the repo-root jsdom unit-test harness.
// Exists so frontend-only runs do not accidentally include generated dist files.

import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

import { resolveFilterestTestRuntimeRoot } from '../server_tools/scripts/test_runtime_paths.mjs';

const frontendRoot = fileURLToPath(new URL('.', import.meta.url));
const applicationRoot = resolve(frontendRoot, '..');

export default {
  root: frontendRoot,
  cacheDir: join(
    resolveFilterestTestRuntimeRoot({ applicationRoot }),
    'vite-cache-frontend',
  ),
  test: {
    environment: 'jsdom',
    include: ['**/*.test.js'],
    exclude: ['dist/**'],
  },
};
