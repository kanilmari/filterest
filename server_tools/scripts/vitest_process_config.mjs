// vitest_process_config.mjs
// Builds runtime-specific Node process inputs for the repository's root Vitest runner.
// Bridges supported Node versions, inherited environment options, and Vitest arguments.
// Isolates Node 25+ Web Storage without sending its flag to the Node 24 support path.
// Keeps the compatibility decision pure so it can be regression-tested without spawning.

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

/**
 * Builds the child Node arguments from Vitest's entrypoint and forwarded npm arguments.
 * This preserves every argument supplied through `npm test -- ...` or
 * `npm run test:watch -- ...` while environment handling remains centralized above.
 */
export function buildVitestNodeArguments({
  forwardedArguments = [],
  vitestEntrypoint,
} = {}) {
  return [vitestEntrypoint, ...forwardedArguments];
}
