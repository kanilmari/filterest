// vitest_process_runner.mjs
// Runs the repository's root Vitest command with runtime-specific Node flags.
// Bridges npm scripts, the installed Node runtime, and Vitest's JavaScript entrypoint.
// Prevents Node 25+ Web Storage globals from replacing jsdom's isolated storage.
// Keeps the compatibility workaround out of application code and test cases.

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildVitestChildEnvironment,
  buildVitestNodeArguments,
} from './vitest_process_config.mjs';

/** Resolves the installed Vitest entrypoint only when the real CLI path needs it. */
function resolveDefaultVitestEntrypoint() {
  return fileURLToPath(new URL('../../node_modules/vitest/vitest.mjs', import.meta.url));
}

/** Distinguishes direct Node execution from imports transformed by the test runner. */
function isDirectInvocation() {
  const moduleUrl = new URL(import.meta.url);
  const invokedModulePath = process.argv[1] ? resolve(process.argv[1]) : '';
  return moduleUrl.protocol === 'file:' && invokedModulePath === fileURLToPath(moduleUrl);
}

/**
 * Starts Vitest as a child of the active Node executable and mirrors its terminal lifecycle.
 * This connects npm to Vitest without discarding inherited NODE_OPTIONS, and relays exit codes and
 * termination signals so CI, watch mode, and interactive cancellation retain normal semantics.
 */
export function runVitest(
  forwardedArguments = process.argv.slice(2),
  {
    logger = console,
    runtimeProcess = process,
    spawnProcess = spawn,
    vitestEntrypoint,
  } = {},
) {
  const resolvedVitestEntrypoint = vitestEntrypoint ?? resolveDefaultVitestEntrypoint();
  const child = spawnProcess(
    runtimeProcess.execPath,
    buildVitestNodeArguments({
      forwardedArguments,
      vitestEntrypoint: resolvedVitestEntrypoint,
    }),
    {
      env: buildVitestChildEnvironment({
        environment: runtimeProcess.env,
        nodeVersion: runtimeProcess.versions.node,
        allowedNodeEnvironmentFlags: runtimeProcess.allowedNodeEnvironmentFlags,
      }),
      stdio: 'inherit',
    },
  );
  const forwardedSignals = ['SIGINT', 'SIGTERM'];
  const signalHandlers = new Map();

  // Removes the parent-side relays once Vitest exits so watch-mode restarts stay clean.
  const removeSignalHandlers = () => {
    for (const [signal, handler] of signalHandlers) {
      runtimeProcess.off(signal, handler);
    }
  };

  for (const signal of forwardedSignals) {
    const handler = () => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill(signal);
      }
    };
    signalHandlers.set(signal, handler);
    runtimeProcess.on(signal, handler);
  }

  child.once('error', (error) => {
    removeSignalHandlers();
    logger.error(`vitest runner failed to start: ${error.message}`);
    runtimeProcess.exitCode = 1;
  });

  child.once('exit', (exitCode, signal) => {
    removeSignalHandlers();
    if (signal) {
      runtimeProcess.kill(runtimeProcess.pid, signal);
      return;
    }
    runtimeProcess.exitCode = exitCode ?? 1;
  });

  return child;
}

if (isDirectInvocation()) {
  runVitest();
}
