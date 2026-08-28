// node_dependency_loader.test.mjs
// Verifies direct tools can load packages from mutable standalone runtime storage.
// Bridges a synthetic dependency tree with Node's CommonJS-compatible resolver.
// Exists so app/node_modules never returns as an ESM compatibility bridge.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

import { requireNodeDependency } from './node_dependency_loader.mjs';

describe('requireNodeDependency', () => {
  test('loads a package from the configured external node_modules root', () => {
    const runtimeRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'filterest-node-dependency-'),
    );
    const nodeModulesRoot = path.join(runtimeRoot, 'node_modules');
    const probeRoot = path.join(nodeModulesRoot, 'filterest-runtime-probe');
    fs.mkdirSync(probeRoot, { recursive: true });
    fs.writeFileSync(
      path.join(probeRoot, 'package.json'),
      JSON.stringify({ name: 'filterest-runtime-probe', main: 'index.cjs' }),
    );
    fs.writeFileSync(
      path.join(probeRoot, 'index.cjs'),
      'module.exports = { marker: "runtime-package-ok" };\n',
    );

    try {
      expect(requireNodeDependency('filterest-runtime-probe', {
        FILTEREST_NODE_MODULES_ROOT: nodeModulesRoot,
      })).toEqual({ marker: 'runtime-package-ok' });
    } finally {
      fs.rmSync(runtimeRoot, { recursive: true, force: true });
    }
  });

  test('rejects a relative configured dependency root', () => {
    expect(() => requireNodeDependency('vitest', {
      FILTEREST_NODE_MODULES_ROOT: 'data/runtime/node/node_modules',
    })).toThrow(/absolute path/);
  });
});
