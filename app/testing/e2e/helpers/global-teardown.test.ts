/**
 * global-teardown.test.ts
 * Proves a rejected parallel runner cannot tear down another PID's registry or auth state,
 * and that the owning run is always released once its own artifacts are gone.
 */

import type { FullConfig } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { afterAll, beforeEach, expect, test, vi } from 'vitest';

// The teardown resolves its runtime paths at import time; point them at a
// throwaway folder before the module loads.
const runtime = vi.hoisted(() => {
  const previous = process.env.FILTEREST_TEST_RUNTIME_ROOT;
  const root = `${process.env.TMPDIR || '/tmp'}/filterest-teardown-test-${process.pid}`;
  process.env.FILTEREST_TEST_RUNTIME_ROOT = root;
  return { previous, root };
});

const cleanupMocks = vi.hoisted(() => ({
  cleanupSyntheticTestArtifactsWithStorageState: vi.fn(),
  normalizeE2EBaseURL: vi.fn((value: string) => value),
  readLangKeyInventoryWithStorageState: vi.fn(),
  validateSyntheticArtifactBaseline: vi.fn(),
}));

const registryMocks = vi.hoisted(() => ({
  finishArtifactRunRegistry: vi.fn(),
  getArtifactRegistryProcessIdentity: vi.fn(),
  getCurrentArtifactRun: vi.fn(),
  listRegisteredTestArtifacts: vi.fn(),
  unregisterTestArtifact: vi.fn(),
}));

const storageMocks = vi.hoisted(() => ({
  removeStorageStateFile: vi.fn(),
}));

const attributionMocks = vi.hoisted(() => ({
  attributeLangKeyDrift: vi.fn(),
  describeMigrationSeededKeys: vi.fn(() => 'server_error_notice (20260922000001_seed.sql)'),
  resolveMigrationDirectories: vi.fn(() => ['/product/app/server_tools/migrations']),
}));

vi.mock('./test-artifact-cleanup', () => cleanupMocks);
vi.mock('./test-artifact-run-registry', () => registryMocks);
vi.mock('./storage-state-file', () => storageMocks);
vi.mock('./lang-key-drift-attribution', () => attributionMocks);

import globalTeardown from '../global-teardown';

const AUTH_DIRECTORY = path.join(runtime.root, 'e2e', '.auth');
const BASELINE_FILE = path.join(AUTH_DIRECTORY, 'artifact-baseline.json');
const BASE_URL = 'https://localhost:9999';

afterAll(() => {
  fs.rmSync(runtime.root, { recursive: true, force: true });
  if (runtime.previous === undefined) {
    delete process.env.FILTEREST_TEST_RUNTIME_ROOT;
  } else {
    process.env.FILTEREST_TEST_RUNTIME_ROOT = runtime.previous;
  }
});

beforeEach(() => {
  vi.clearAllMocks();
  registryMocks.getArtifactRegistryProcessIdentity.mockReturnValue({
    pid: process.pid,
    processNonce: 'a'.repeat(64),
  });
});

test('foreign artifact run fails before registry, cleanup, or auth-state mutation', async () => {
  registryMocks.getCurrentArtifactRun.mockReturnValue({
    version: 1,
    runId: 'run-foreign-owner',
    pid: process.pid + 1,
    processNonce: 'b'.repeat(64),
    startedAt: '2026-01-01T00:00:00.000Z',
    isPidActive: true,
  });

  await expect(globalTeardown({} as FullConfig)).rejects.toThrow(
    `belongs to another process identity (recorded PID ${process.pid + 1}, `
    + `teardown PID ${process.pid})`,
  );

  expect(registryMocks.listRegisteredTestArtifacts).not.toHaveBeenCalled();
  expect(registryMocks.unregisterTestArtifact).not.toHaveBeenCalled();
  expect(registryMocks.finishArtifactRunRegistry).not.toHaveBeenCalled();
  expect(cleanupMocks.cleanupSyntheticTestArtifactsWithStorageState).not.toHaveBeenCalled();
  expect(cleanupMocks.readLangKeyInventoryWithStorageState).not.toHaveBeenCalled();
  expect(storageMocks.removeStorageStateFile).not.toHaveBeenCalled();
});

test('same-PID foreign nonce fails before registry, cleanup, or auth-state mutation', async () => {
  registryMocks.getCurrentArtifactRun.mockReturnValue({
    version: 1,
    runId: 'run-reused-pid-owner',
    pid: process.pid,
    processNonce: 'b'.repeat(64),
    startedAt: '2026-01-01T00:00:00.000Z',
    isPidActive: true,
  });

  await expect(globalTeardown({} as FullConfig)).rejects.toThrow(
    `belongs to another process identity (recorded PID ${process.pid}, `
    + `teardown PID ${process.pid})`,
  );

  expect(registryMocks.listRegisteredTestArtifacts).not.toHaveBeenCalled();
  expect(registryMocks.unregisterTestArtifact).not.toHaveBeenCalled();
  expect(registryMocks.finishArtifactRunRegistry).not.toHaveBeenCalled();
  expect(cleanupMocks.cleanupSyntheticTestArtifactsWithStorageState).not.toHaveBeenCalled();
  expect(cleanupMocks.readLangKeyInventoryWithStorageState).not.toHaveBeenCalled();
  expect(storageMocks.removeStorageStateFile).not.toHaveBeenCalled();
});

/** Prepares an owned run whose single dataset cleanup succeeded and whose keys drifted. */
function prepareOwnedRunWithKeyDrift(addedKey: string) {
  fs.mkdirSync(AUTH_DIRECTORY, { recursive: true });
  fs.writeFileSync(path.join(AUTH_DIRECTORY, 'user.json'), '{}');
  fs.writeFileSync(BASELINE_FILE, '{}');
  registryMocks.getCurrentArtifactRun.mockReturnValue({
    version: 1,
    runId: 'run-own',
    pid: process.pid,
    processNonce: 'a'.repeat(64),
    startedAt: '2026-01-01T00:00:00.000Z',
    isPidActive: true,
  });
  cleanupMocks.validateSyntheticArtifactBaseline.mockReturnValue({
    runId: 'run-own', baseURL: BASE_URL, langKeys: ['existing_key'], totalLangKeyCount: 1,
  });
  registryMocks.listRegisteredTestArtifacts.mockReturnValue([
    { kind: 'dataset', name: 'e2e_owned_dataset', status: 'confirmed' },
  ]);
  cleanupMocks.cleanupSyntheticTestArtifactsWithStorageState.mockResolvedValue({
    deletedDatasets: ['e2e_owned_dataset'], deletedFolders: [], deletedLangKeys: [],
    remainingDatasetNames: [], remainingFolderNames: [], remainingSyntheticLangKeys: [],
    totalLangKeyCount: 2,
  });
  cleanupMocks.readLangKeyInventoryWithStorageState.mockResolvedValue({
    allLangKeys: ['existing_key', addedKey], totalLangKeyCount: 2,
  });
}

const ownedRunConfig = { projects: [{ use: { baseURL: BASE_URL } }] } as unknown as FullConfig;

function expectRunReleased() {
  expect(registryMocks.unregisterTestArtifact).toHaveBeenCalledWith('dataset', 'e2e_owned_dataset', 'run-own');
  expect(registryMocks.finishArtifactRunRegistry).toHaveBeenCalledWith('run-own');
  expect(fs.existsSync(BASELINE_FILE)).toBe(false);
  expect(storageMocks.removeStorageStateFile).toHaveBeenCalledTimes(1);
}

test('keys a migration seeded mid-run are reported, and the run is released', async () => {
  prepareOwnedRunWithKeyDrift('server_error_notice');
  attributionMocks.attributeLangKeyDrift.mockReturnValue({
    migrationSeeded: [{ key: 'server_error_notice', migrations: ['20260922000001_seed.sql'] }],
    unexplainedAdded: [],
    removed: [],
  });
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

  await expect(globalTeardown(ownedRunConfig)).resolves.toBeUndefined();

  expect(attributionMocks.attributeLangKeyDrift).toHaveBeenCalledWith(
    ['server_error_notice'], [], ['/product/app/server_tools/migrations'],
  );
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('by database migration(s), not by the tests'));
  expectRunReleased();
  warn.mockRestore();
});

test('an unexplained key still fails the run without leaving a stale run record', async () => {
  prepareOwnedRunWithKeyDrift('e2e_leaked_key');
  attributionMocks.attributeLangKeyDrift.mockReturnValue({
    migrationSeeded: [], unexplainedAdded: ['e2e_leaked_key'], removed: [],
  });

  await expect(globalTeardown(ownedRunConfig)).rejects.toThrow(
    /lang-key baseline drifted during E2E run: .*added=e2e_leaked_key; removed=none/,
  );

  expectRunReleased();
});
