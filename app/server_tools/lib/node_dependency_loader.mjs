// node_dependency_loader.mjs
// Loads Node dependencies from the installation-owned development package tree.
// Bridges direct ESM tools under immutable app/ with mutable standalone node_modules.
// Exists because Node's ESM resolver does not honor NODE_PATH for bare imports.

import { createRequire } from 'node:module';
import path from 'node:path';

/**
 * Loads one trusted package name through the configured dependency tree.
 * The standalone root command supplies an absolute FILTEREST_NODE_MODULES_ROOT;
 * embedded Easelect and legacy flat source trees retain normal ancestor lookup.
 */
export function requireNodeDependency(
  packageName,
  environment = process.env,
) {
  const configuredRoot = String(
    environment.FILTEREST_NODE_MODULES_ROOT || '',
  ).trim();
  if (!configuredRoot) {
    return createRequire(import.meta.url)(packageName);
  }
  if (!path.isAbsolute(configuredRoot)) {
    throw new Error('FILTEREST_NODE_MODULES_ROOT must be an absolute path');
  }

  const packageRequire = createRequire(
    path.join(path.dirname(configuredRoot), 'package.json'),
  );
  return packageRequire(packageName);
}
