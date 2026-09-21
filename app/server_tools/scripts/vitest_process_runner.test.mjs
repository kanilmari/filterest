// vitest_process_runner.test.mjs
// Verifies the Node-version compatibility decisions used by the root Vitest runner.
// Bridges simulated supported runtimes, forwarded npm arguments, and child Node arguments.
// Proves a given test target is honoured with a separator or a repository-root path.
// Prevents the Node 25 Web Storage workaround from breaking the supported Node 24 path.
// Keeps test-command compatibility independently regression-tested.

import { EventEmitter } from 'node:events';
import { basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test, vi } from 'vitest';

import {
  buildVitestChildEnvironment,
  buildVitestNodeArguments,
  normalizeVitestTargetArguments,
  resolveVitestMaxWorkers,
  shouldDisableNodeWebStorage,
} from './vitest_process_config.mjs';
import { runVitest } from './vitest_process_runner.mjs';

const SUPPORTED_WEB_STORAGE_FLAG = new Set(['--no-experimental-webstorage']);

// Simulates a filesystem through the injected resolver: each existing path maps to its
// real path, and anything absent resolves to null, so no test touches the real disk.
function simulatedFilesystem(realPathsByPath) {
  const realPaths = new Map(Object.entries(realPathsByPath));
  return (path) => realPaths.get(path) ?? null;
}

// A standalone checkout: repository root /repo, application folder /repo/app.
const SIMULATED_STANDALONE_LAYOUT = {
  workingDirectory: '/repo/app',
  projectRoot: '/repo',
  resolveExistingPath: simulatedFilesystem({
    '/repo/app': '/repo/app',
    '/repo/app/frontend/core': '/repo/app/frontend/core',
    '/repo/app/frontend/core/a.test.js': '/repo/app/frontend/core/a.test.js',
    '/repo/docs/guide': '/repo/docs/guide',
  }),
};

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
      '--configLoader=runner',
    ]);
  });

  test('preserves an explicit config-loader override without adding a duplicate', () => {
    expect(buildVitestNodeArguments({
      forwardedArguments: ['run', '--configLoader', 'bundle'],
      vitestEntrypoint: '/repo/node_modules/vitest/vitest.mjs',
    })).toEqual([
      '/repo/node_modules/vitest/vitest.mjs',
      'run',
      '--configLoader',
      'bundle',
    ]);
  });

  // `./filterest test-unit -- <target>` reaches the runner as `run -- <target>`.
  // Vitest treats everything after a bare `--` as pass-through, so the target and
  // the config-loader choice were both dropped and the whole suite ran.
  test('keeps a target and the config loader in force after a bare separator', () => {
    expect(buildVitestNodeArguments({
      forwardedArguments: ['run', '--', 'frontend/example'],
      vitestEntrypoint: '/repo/node_modules/vitest/vitest.mjs',
      targetResolution: SIMULATED_STANDALONE_LAYOUT,
    })).toEqual([
      '/repo/node_modules/vitest/vitest.mjs',
      'run',
      'frontend/example',
      '--configLoader=runner',
    ]);
  });
});

describe('normalizeVitestTargetArguments', () => {
  test('drops every bare separator and keeps the arguments around it in order', () => {
    expect(normalizeVitestTargetArguments(
      ['run', '--', 'frontend/core', '--', '--reporter=verbose'],
      SIMULATED_STANDALONE_LAYOUT,
    )).toEqual(['run', 'frontend/core', '--reporter=verbose']);
  });

  test('rewrites a target written from the repository root to the application-relative form', () => {
    expect(normalizeVitestTargetArguments(
      ['run', 'app/frontend/core', 'app/frontend/core/', 'app/frontend/core/a.test.js'],
      SIMULATED_STANDALONE_LAYOUT,
    )).toEqual(['run', 'frontend/core', 'frontend/core/', 'frontend/core/a.test.js']);
  });

  test('leaves application-relative targets, name filters and option values unchanged', () => {
    const argumentsAsWritten = [
      'run',
      'frontend/core',
      'core_components/partial/name',
      'symbol_picker',
      '-t',
      'saves a row',
      '--config',
      'vitest.config.mjs',
      '--outputFile=app/frontend/core',
      '/repo/app/frontend/core',
    ];
    expect(normalizeVitestTargetArguments(argumentsAsWritten, SIMULATED_STANDALONE_LAYOUT))
      .toEqual(argumentsAsWritten);
  });

  // A target that exists nowhere, or only outside the tested folder, must reach Vitest as
  // written: Vitest then fails with "No test files found" and names the filter, rather
  // than this runner guessing a different target or widening the run.
  test('passes a missing or out-of-tree target through for Vitest to reject by name', () => {
    expect(normalizeVitestTargetArguments(
      ['run', 'app/frontend/missing', 'docs/guide'],
      SIMULATED_STANDALONE_LAYOUT,
    )).toEqual(['run', 'app/frontend/missing', 'docs/guide']);
  });

  test('falls back to the parent of the application folder when no root is named', () => {
    expect(normalizeVitestTargetArguments(['run', 'app/frontend/core'], {
      ...SIMULATED_STANDALONE_LAYOUT,
      projectRoot: '',
    })).toEqual(['run', 'frontend/core']);
  });

  // The maintenance shell names its own root and reaches the application through a link.
  test('follows a linked application folder from a composing repository root', () => {
    expect(normalizeVitestTargetArguments(['run', 'filterest/app/frontend/core/'], {
      workingDirectory: '/repo/app',
      projectRoot: '/shell',
      resolveExistingPath: simulatedFilesystem({
        '/repo/app': '/repo/app',
        '/shell/filterest/app/frontend/core': '/repo/app/frontend/core',
      }),
    })).toEqual(['run', 'frontend/core/']);
  });

  test('resolves a repository-root target against the real application folder', () => {
    const applicationFolder = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
    const thisTestFile = 'server_tools/scripts/vitest_process_runner.test.mjs';
    expect(normalizeVitestTargetArguments(
      ['run', `${basename(applicationFolder)}/${thisTestFile}`],
      { workingDirectory: applicationFolder, projectRoot: dirname(applicationFolder) },
    )).toEqual(['run', thisTestFile]);
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
      [
        '/repo/node_modules/vitest/vitest.mjs',
        'run',
        'example.test.js',
        '--configLoader=runner',
      ],
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
