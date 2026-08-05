// vitest.config.mjs
// Frontend-local Vitest configuration for direct frontend unit-test runs.
// Bridges cwd=frontend developer runs and the repo-root jsdom unit-test harness.
// Exists so frontend-only runs do not accidentally include generated dist files.

import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const frontendRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: frontendRoot,
  test: {
    environment: 'jsdom',
    include: ['**/*.test.js'],
    exclude: ['dist/**'],
  },
});
