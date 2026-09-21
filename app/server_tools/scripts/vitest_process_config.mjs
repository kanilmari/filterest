// vitest_process_config.mjs
// Builds runtime-specific Node process inputs for the repository's root Vitest runner.
// Bridges supported Node versions, inherited environment options, and Vitest arguments.
// Isolates Node 25+ Web Storage without sending its flag to the Node 24 support path.
// Keeps a given test target honoured however the command line spells it.
// Keeps the compatibility decision pure so it can be regression-tested without spawning.

import { realpathSync } from 'node:fs';
import {
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from 'node:path';

const DISABLE_EXPERIMENTAL_WEB_STORAGE_FLAG = '--no-experimental-webstorage';

/**
 * Caps Vitest's parallel child-process startup on supported macOS/Linux runtimes.
 * Explicit CLI and VITEST_MAX_WORKERS values remain owned by Vitest itself.
 */
export function resolveVitestMaxWorkers({
  platform = process.platform,
  nodeVersion = process.versions.node,
  environment = process.env,
  processArguments = process.argv.slice(2),
} = {}) {
  const hasCliOverride = processArguments.some(
    (argument) => argument === '--maxWorkers' || argument.startsWith('--maxWorkers='),
  );
  const hasEnvironmentOverride = Object.hasOwn(environment, 'VITEST_MAX_WORKERS')
    && String(environment.VITEST_MAX_WORKERS).trim() !== '';
  if (hasCliOverride || hasEnvironmentOverride) {
    return undefined;
  }

  const majorVersionMatch = String(nodeVersion).match(/^(\d+)/);
  const majorVersion = majorVersionMatch
    ? Number.parseInt(majorVersionMatch[1], 10)
    : Number.NaN;

  if (
    ['darwin', 'linux'].includes(platform)
    && Number.isFinite(majorVersion)
    && majorVersion >= 24
  ) {
    return 2;
  }

  return undefined;
}

/**
 * Checks the current Node runtime and its supported flags before disabling Web Storage.
 * This connects Node version detection to Vitest process isolation so Node 24 never
 * receives a compatibility flag intended for the Node 25+ global-storage behavior.
 */
export function shouldDisableNodeWebStorage(
  nodeVersion = process.versions.node,
  allowedNodeEnvironmentFlags = process.allowedNodeEnvironmentFlags,
) {
  const majorVersionMatch = String(nodeVersion).match(/^(\d+)/);
  const majorVersion = majorVersionMatch
    ? Number.parseInt(majorVersionMatch[1], 10)
    : Number.NaN;

  return (
    Number.isFinite(majorVersion)
    && majorVersion >= 25
    && allowedNodeEnvironmentFlags.has(DISABLE_EXPERIMENTAL_WEB_STORAGE_FLAG)
  );
}

/**
 * Builds Vitest's child environment without mutating or replacing inherited options.
 * This connects the Node 25 compatibility flag to Vitest's worker processes, where the
 * jsdom collision occurs, while leaving the supported Node 24 environment unchanged.
 */
export function buildVitestChildEnvironment({
  environment = process.env,
  nodeVersion = process.versions.node,
  allowedNodeEnvironmentFlags = process.allowedNodeEnvironmentFlags,
} = {}) {
  const childEnvironment = { ...environment };

  if (!shouldDisableNodeWebStorage(nodeVersion, allowedNodeEnvironmentFlags)) {
    return childEnvironment;
  }

  const currentNodeOptions = environment.NODE_OPTIONS ?? '';
  if (currentNodeOptions.includes(DISABLE_EXPERIMENTAL_WEB_STORAGE_FLAG)) {
    return childEnvironment;
  }

  const separator = currentNodeOptions.length > 0 && !/\s$/.test(currentNodeOptions)
    ? ' '
    : '';
  childEnvironment.NODE_OPTIONS = `${currentNodeOptions}${separator}${DISABLE_EXPERIMENTAL_WEB_STORAGE_FLAG}`;
  return childEnvironment;
}

/** Returns the real path of an existing file or folder, or null when nothing is there. */
function resolveExistingRealPath(path) {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

/**
 * Rewrites one path-shaped test target, written from the repository root, into the
 * working-folder-relative form Vitest matches against. Anything else is returned
 * unchanged, so a name fragment or an option value keeps its Vitest meaning.
 */
function rebaseRepositoryRootTarget(argument, {
  workingDirectory,
  realWorkingDirectory,
  repositoryRoots,
  resolveExistingPath,
}) {
  if (argument.startsWith('-') || isAbsolute(argument) || !argument.includes('/')) {
    return argument;
  }
  if (resolveExistingPath(resolve(workingDirectory, argument))) {
    return argument;
  }
  for (const repositoryRoot of repositoryRoots) {
    const target = resolveExistingPath(resolve(repositoryRoot, argument));
    if (!target) {
      continue;
    }
    const workingRelativeTarget = relative(realWorkingDirectory, target);
    if (
      workingRelativeTarget === '..'
      || workingRelativeTarget.startsWith(`..${sep}`)
      || isAbsolute(workingRelativeTarget)
    ) {
      continue;
    }
    if (!workingRelativeTarget) {
      return '.';
    }
    // Vitest reads a trailing slash as "this folder only", not a name prefix.
    return argument.endsWith('/') ? `${workingRelativeTarget}/` : workingRelativeTarget;
  }
  return argument;
}

/**
 * Makes a given test target apply however the command line spells it.
 * Vitest runs every test and silently ignores the target when it follows a bare `--`,
 * and it matches targets only against paths relative to its working folder, which the
 * launchers set to the application folder. A bare `--` is therefore dropped (npm and the
 * launchers already consume their own separator; Vitest has no use for one), and a
 * path written from the repository root such as `app/frontend/...` is rewritten to the
 * folder-relative form when it names an existing path inside the working folder. A
 * target that exists nowhere is left as written, so Vitest reports that no test file
 * matched it and exits with a failure instead of running the whole suite.
 */
export function normalizeVitestTargetArguments(forwardedArguments = [], {
  workingDirectory = process.cwd(),
  projectRoot = process.env.FILTEREST_PROJECT_ROOT_OVERRIDE,
  resolveExistingPath = resolveExistingRealPath,
} = {}) {
  const realWorkingDirectory = resolveExistingPath(workingDirectory) ?? resolve(workingDirectory);
  // The launchers name the repository root explicitly; a plain `npm test` inside the
  // application folder leaves its parent, which is the standalone repository root.
  const repositoryRoots = [
    ...new Set(
      [projectRoot?.trim(), dirname(realWorkingDirectory)]
        .filter(Boolean)
        .map((root) => resolve(root)),
    ),
  ];
  return forwardedArguments
    .filter((argument) => argument !== '--')
    .map((argument) => rebaseRepositoryRootTarget(argument, {
      workingDirectory,
      realWorkingDirectory,
      repositoryRoots,
      resolveExistingPath,
    }));
}

/**
 * Builds the child Node arguments from Vitest's entrypoint and forwarded npm arguments.
 * This preserves every argument supplied through `npm test -- ...` or
 * `npm run test:watch -- ...`, after `normalizeVitestTargetArguments` has made any given
 * test target apply, while environment handling remains centralized above.
 */
export function buildVitestNodeArguments({
  forwardedArguments = [],
  vitestEntrypoint,
  targetResolution = {},
} = {}) {
  const targetArguments = normalizeVitestTargetArguments(forwardedArguments, targetResolution);
  const hasConfigLoaderOverride = targetArguments.some(
    (argument) => argument === '--configLoader' || argument.startsWith('--configLoader='),
  );
  const immutableConfigArguments = hasConfigLoaderOverride
    ? targetArguments
    : [...targetArguments, '--configLoader=runner'];
  return [vitestEntrypoint, ...immutableConfigArguments];
}
