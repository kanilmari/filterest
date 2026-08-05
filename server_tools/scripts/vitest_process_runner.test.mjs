// vitest_process_runner.test.mjs
// Verifies the Node-version compatibility decisions used by the root Vitest runner.
// Bridges simulated supported runtimes, forwarded npm arguments, and child Node arguments.
// Prevents the Node 25 Web Storage workaround from breaking the supported Node 24 path.
// Keeps test-command compatibility independently regression-tested.

import { EventEmitter } from 'node:events';

import { describe, expect, test, vi } from 'vitest';

import {
  buildVitestChildEnvironment,
  buildVitestNodeArguments,
  resolveVitestMaxWorkers,
  shouldDisableNodeWebStorage,
} from './vitest_process_config.mjs';
import { runVitest } from './vitest_process_runner.mjs';

const SUPPORTED_WEB_STORAGE_FLAG = new Set(['--no-experimental-webstorage']);

describe('resolveVitestMaxWorkers', () => {
  test('caps fork startup concurrency on every supported platform and Node version', () => {
    expect(resolveVitestMaxWorkers({
      platform: 'darwin',
      nodeVersion: '25.6.1',
      environment: {},
      processArguments: [],
    })).toBe(2);
    expect(resolveVitestMaxWorkers({
      platform: 'darwin',
      nodeVersion: '24.18.0',
      environment: {},
      processArguments: [],
    })).toBe(2);
    expect(resolveVitestMaxWorkers({
      platform: 'linux',
      nodeVersion: '25.6.1',
      environment: {},
      processArguments: [],
    })).toBe(2);
    expect(resolveVitestMaxWorkers({
      platform: 'linux',
      nodeVersion: '24.18.0',
      environment: {},
      processArguments: [],
    })).toBe(2);
  });

  test('leaves unsupported older and unparseable Node versions unchanged', () => {
    expect(resolveVitestMaxWorkers({
      nodeVersion: '23.11.0',
      environment: {},
      processArguments: [],
    })).toBeUndefined();
    expect(resolveVitestMaxWorkers({
      nodeVersion: 'unknown',
      environment: {},
      processArguments: [],
    })).toBeUndefined();
    expect(resolveVitestMaxWorkers({
      platform: 'win32',
      nodeVersion: '25.6.1',
      environment: {},
      processArguments: [],
    })).toBeUndefined();
  });

  test('preserves explicit CLI and environment worker overrides', () => {
    expect(resolveVitestMaxWorkers({
      nodeVersion: '25.6.1',
      environment: {},
      processArguments: ['run', '--maxWorkers=2'],
    })).toBeUndefined();
    expect(resolveVitestMaxWorkers({
      nodeVersion: '25.6.1',
      environment: {},
      processArguments: ['run', '--maxWorkers', '2'],
    })).toBeUndefined();
    expect(resolveVitestMaxWorkers({
      nodeVersion: '25.6.1',
      environment: { VITEST_MAX_WORKERS: '3' },
      processArguments: ['run'],
    })).toBeUndefined();
  });
});

describe('shouldDisableNodeWebStorage', () => {
  test('enables isolation for Node 25 when the runtime advertises the flag', () => {
    expect(shouldDisableNodeWebStorage('25.6.1', SUPPORTED_WEB_STORAGE_FLAG)).toBe(true);
  });

  test('leaves the supported Node 24 path unchanged even if the flag is advertised', () => {
    expect(shouldDisableNodeWebStorage('24.18.0', SUPPORTED_WEB_STORAGE_FLAG)).toBe(false);
  });

  test('does not pass an unknown flag to a newer runtime', () => {
    expect(shouldDisableNodeWebStorage('25.6.1', new Set())).toBe(false);
  });
});

describe('buildVitestChildEnvironment', () => {
  test('appends Node 25 isolation while preserving existing NODE_OPTIONS', () => {
    const environment = {
      NODE_OPTIONS: '--max-old-space-size=4096',
      TEST_MARKER: 'preserved',
    };

    expect(buildVitestChildEnvironment({
      environment,
      nodeVersion: '25.6.1',
      allowedNodeEnvironmentFlags: SUPPORTED_WEB_STORAGE_FLAG,
    })).toEqual({
      NODE_OPTIONS: '--max-old-space-size=4096 --no-experimental-webstorage',
      TEST_MARKER: 'preserved',
    });
    expect(environment.NODE_OPTIONS).toBe('--max-old-space-size=4096');
  });

  test('does not add the compatibility option on Node 24', () => {
    expect(buildVitestChildEnvironment({
      environment: { NODE_OPTIONS: '--trace-warnings' },
      nodeVersion: '24.18.0',
      allowedNodeEnvironmentFlags: SUPPORTED_WEB_STORAGE_FLAG,
    })).toEqual({ NODE_OPTIONS: '--trace-warnings' });
  });

  test('does not duplicate an existing compatibility option', () => {
    expect(buildVitestChildEnvironment({
      environment: { NODE_OPTIONS: '--no-experimental-webstorage' },
      nodeVersion: '25.6.1',
      allowedNodeEnvironmentFlags: SUPPORTED_WEB_STORAGE_FLAG,
    })).toEqual({ NODE_OPTIONS: '--no-experimental-webstorage' });
  });
});

describe('buildVitestNodeArguments', () => {
  test('forwards npm arguments after the Vitest entrypoint', () => {
    expect(buildVitestNodeArguments({
      forwardedArguments: ['run', 'frontend/example.test.js'],
      vitestEntrypoint: '/repo/node_modules/vitest/vitest.mjs',
    })).toEqual([
      '/repo/node_modules/vitest/vitest.mjs',
      'run',
      'frontend/example.test.js',
    ]);
  });
});

// Builds an in-memory process/child pair so lifecycle tests never signal the real runner.
function createRunnerHarness() {
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.kill = vi.fn();

  const runtimeProcess = new EventEmitter();
  runtimeProcess.allowedNodeEnvironmentFlags = SUPPORTED_WEB_STORAGE_FLAG;
  runtimeProcess.env = { TEST_MARKER: 'preserved' };
  runtimeProcess.execPath = '/runtime/node';
  runtimeProcess.exitCode = undefined;
  runtimeProcess.kill = vi.fn();
  runtimeProcess.pid = 4321;
  runtimeProcess.versions = { node: '25.6.1' };

  const spawnProcess = vi.fn(() => child);
  const logger = { error: vi.fn() };
  const spawnedChild = runVitest(['run', 'example.test.js'], {
    logger,
    runtimeProcess,
    spawnProcess,
    vitestEntrypoint: '/repo/node_modules/vitest/vitest.mjs',
  });

  return {
    child,
    logger,
    runtimeProcess,
    spawnedChild,
    spawnProcess,
  };
}

describe('runVitest', () => {
  test('propagates a normal zero exit and a non-zero exit', () => {
    const successful = createRunnerHarness();
    successful.child.emit('exit', 0, null);
    expect(successful.runtimeProcess.exitCode).toBe(0);

    const failed = createRunnerHarness();
    failed.child.emit('exit', 7, null);
    expect(failed.runtimeProcess.exitCode).toBe(7);
  });

  test('reports spawn errors without exposing child arguments or environment', () => {
    const harness = createRunnerHarness();
    harness.child.emit('error', new Error('spawn unavailable'));

    expect(harness.runtimeProcess.exitCode).toBe(1);
    expect(harness.logger.error).toHaveBeenCalledWith(
      'vitest runner failed to start: spawn unavailable',
    );
    expect(harness.logger.error.mock.calls.flat().join(' ')).not.toContain('TEST_MARKER');
  });

  test.each(['SIGINT', 'SIGTERM'])('forwards %s and mirrors the child signal', (signal) => {
    const harness = createRunnerHarness();

    harness.runtimeProcess.emit(signal);
    expect(harness.child.kill).toHaveBeenCalledWith(signal);

    harness.child.signalCode = signal;
    harness.child.emit('exit', null, signal);
    expect(harness.runtimeProcess.kill).toHaveBeenCalledWith(4321, signal);
    expect(harness.runtimeProcess.listenerCount(signal)).toBe(0);
  });

  test('spawns the configured Node entrypoint with inherited stdio', () => {
    const harness = createRunnerHarness();

    expect(harness.spawnedChild).toBe(harness.child);
    expect(harness.spawnProcess).toHaveBeenCalledWith(
      '/runtime/node',
      ['/repo/node_modules/vitest/vitest.mjs', 'run', 'example.test.js'],
      {
        env: {
          NODE_OPTIONS: '--no-experimental-webstorage',
          TEST_MARKER: 'preserved',
        },
        stdio: 'inherit',
      },
    );
  });
});
