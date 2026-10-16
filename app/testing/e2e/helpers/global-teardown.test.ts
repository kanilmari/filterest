/**
 * global-teardown.test.ts
 * Proves foreign runners cannot mutate state and every teardown failure reports honestly.
 * Connects fake APIs to real cleanup branches while keeping failed-run ownership evidence.
 */

import { request as playwrightRequest, type FullConfig } from '@playwright/test';
import { createHash } from 'node:crypto';
import * as fs from 'fs';
import * as path from 'path';
import { afterAll, beforeEach, expect, test, vi } from 'vitest';
import { fakeApi, response } from './test-artifact-recovery-fakes';

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
  resolveArtifactRegistryRoot: vi.fn(),
  unregisterTestArtifact: vi.fn(),
}));

const storageMocks = vi.hoisted(() => ({
  removeStorageStateFile: vi.fn(),
}));

const sourceMocks = vi.hoisted(() => ({ readLangKeySourcesWithStorageState: vi.fn() }));
const historyMocks = vi.hoisted(() => ({ readCompletedDatasetNames: vi.fn() }));

vi.mock('./test-artifact-cleanup', () => ({
  ...cleanupMocks,
  cleanupSyntheticTestArtifactsWithStorageState: async (
    ...args: Parameters<typeof import('./test-artifact-cleanup').cleanupSyntheticTestArtifactsWithStorageState>
  ) => {
    const summary = await cleanupMocks.cleanupSyntheticTestArtifactsWithStorageState(...args);
    // Resolved fixture summaries model the real helper's per-artifact absence proofs.
    for (const artifact of args[3]) {
      const deleted = artifact.kind === 'dataset' ? summary.deletedDatasets : summary.deletedFolders;
      const remaining = artifact.kind === 'dataset' ? summary.remainingDatasetNames : summary.remainingFolderNames;
      if (deleted.includes(artifact.name) && !remaining.includes(artifact.name)) args[4]?.(artifact);
    }
    return summary;
  },
}));
vi.mock('./test-artifact-run-registry', () => registryMocks);
vi.mock('./storage-state-file', () => storageMocks);
vi.mock('./lang-key-source-inventory', () => sourceMocks);
vi.mock('./test-artifact-dataset-history', () => historyMocks);

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
  fs.rmSync(runtime.root, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.clearAllMocks();
  registryMocks.resolveArtifactRegistryRoot.mockReturnValue(path.join(AUTH_DIRECTORY, 'artifact-runs'));
  registryMocks.unregisterTestArtifact.mockImplementation((kind, name) => {
    registryMocks.listRegisteredTestArtifacts.mockReturnValue(
      registryMocks.listRegisteredTestArtifacts().filter(artifact => artifact.kind !== kind || artifact.name !== name),
    );
  });
  registryMocks.finishArtifactRunRegistry.mockImplementation((runId) => {
    fs.rmSync(path.join(AUTH_DIRECTORY, 'artifact-runs', runId), { recursive: true, force: true });
  });
  historyMocks.readCompletedDatasetNames.mockReturnValue([]);
  sourceMocks.readLangKeySourcesWithStorageState.mockResolvedValue(new Map());
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
  fs.mkdirSync(path.join(AUTH_DIRECTORY, 'artifact-runs', 'run-own'), { recursive: true });
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
    userId: 4, username: 'test_admin', datasets: [], folders: [],
    capturedAt: '2026-01-01T00:00:00.000Z',
  });
  registryMocks.listRegisteredTestArtifacts.mockReturnValue([
    { kind: 'dataset', name: 'e2e_owned_dataset', status: 'confirmed', runId: 'run-own', serverId: 17 },
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

function expectFailureEvidenceKept(activeReleased = true, runReleased = activeReleased) {
  if (activeReleased) {
    expect(registryMocks.unregisterTestArtifact).toHaveBeenCalledWith('dataset', 'e2e_owned_dataset', 'run-own');
  } else {
    expect(registryMocks.unregisterTestArtifact).not.toHaveBeenCalled();
  }
  if (runReleased) expect(registryMocks.finishArtifactRunRegistry).toHaveBeenCalledWith('run-own');
  else expect(registryMocks.finishArtifactRunRegistry).not.toHaveBeenCalled();
  expect(fs.existsSync(BASELINE_FILE)).toBe(true);
  expect(storageMocks.removeStorageStateFile).toHaveBeenCalledTimes(1);
}

test('an unrelated migration key fails strict own-run attribution and keeps the evidence', async () => {
  prepareOwnedRunWithKeyDrift('server_error_notice');
  await expect(globalTeardown(ownedRunConfig)).rejects.toThrow(/added=server_error_notice/);
  expectFailureEvidenceKept();
});

test('an unexplained key still fails the run and keeps the evidence', async () => {
  prepareOwnedRunWithKeyDrift('e2e_leaked_key');

  await expect(globalTeardown(ownedRunConfig)).rejects.toThrow(
    /lang-key baseline drifted during E2E run: .*added=e2e_leaked_key; removed=none/,
  );

  expectFailureEvidenceKept();
});

const retainedKey = 'add_row_e2e_owned_dataset';
const REPORT_FILE = path.join(runtime.root, 'e2e', 'lang-key-retention', 'run-own.json');

test('own-run keys are retained and their count and exact names are printed and persisted', async () => {
  prepareOwnedRunWithKeyDrift(retainedKey);
  sourceMocks.readLangKeySourcesWithStorageState.mockResolvedValue(new Map([[retainedKey, []]]));
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  await expect(globalTeardown(ownedRunConfig)).resolves.toBeUndefined();
  expectRunReleased();
  expect(log).toHaveBeenCalledWith(expect.stringContaining(`count=1; names=${retainedKey}`));
  expect(JSON.parse(fs.readFileSync(REPORT_FILE, 'utf8'))).toMatchObject({
    runId: 'run-own', retainedOwnRunLangKeyCount: 1, retainedOwnRunLangKeys: [retainedKey],
    status: 'complete', unverifiedOwnRunLangKeys: [],
  });
});

test('a surviving bare dataset-name key is attributed after cleanup rather than rejected as an artifact', async () => {
  prepareOwnedRunWithKeyDrift('e2e_owned_dataset');
  cleanupMocks.cleanupSyntheticTestArtifactsWithStorageState.mockResolvedValue({
    deletedDatasets: ['e2e_owned_dataset'], deletedFolders: [], deletedLangKeys: [],
    remainingDatasetNames: [], remainingFolderNames: [], remainingSyntheticLangKeys: ['e2e_owned_dataset'],
  });
  sourceMocks.readLangKeySourcesWithStorageState.mockResolvedValue(new Map([['e2e_owned_dataset', []]]));
  await expect(globalTeardown(ownedRunConfig)).resolves.toBeUndefined();
  expect(JSON.parse(fs.readFileSync(REPORT_FILE, 'utf8')).retainedOwnRunLangKeys).toEqual(['e2e_owned_dataset']);
});

test('completed per-test datasets still attribute keys when the active registry is empty', async () => {
  prepareOwnedRunWithKeyDrift(retainedKey);
  registryMocks.listRegisteredTestArtifacts.mockReturnValue([]);
  historyMocks.readCompletedDatasetNames.mockReturnValue(['e2e_owned_dataset']);
  sourceMocks.readLangKeySourcesWithStorageState.mockResolvedValue(new Map([[retainedKey, []]]));
  await expect(globalTeardown(ownedRunConfig)).resolves.toBeUndefined();
  expect(historyMocks.readCompletedDatasetNames).toHaveBeenCalledWith(
    path.join(AUTH_DIRECTORY, 'artifact-runs', 'run-own'), 'run-own',
  );
});

test('negative control: an own-looking key with another counting source fails teardown', async () => {
  prepareOwnedRunWithKeyDrift(retainedKey);
  sourceMocks.readLangKeySourcesWithStorageState.mockResolvedValue(new Map([[retainedKey, [{
    source_type: 'code', source_high: 'another.js', source_low: '',
  }]]]));
  await expect(globalTeardown(ownedRunConfig)).rejects.toThrow(`added=${retainedKey}`);
  expectFailureEvidenceKept();
  expect(JSON.parse(fs.readFileSync(REPORT_FILE, 'utf8')).retainedOwnRunLangKeyCount).toBe(0);
});

test('a removed baseline key fails even when the own addition is accepted', async () => {
  prepareOwnedRunWithKeyDrift(retainedKey);
  cleanupMocks.readLangKeyInventoryWithStorageState.mockResolvedValue({ allLangKeys: [retainedKey], totalLangKeyCount: 1 });
  sourceMocks.readLangKeySourcesWithStorageState.mockResolvedValue(new Map([[retainedKey, []]]));
  await expect(globalTeardown(ownedRunConfig)).rejects.toThrow(/added=none; removed=existing_key/);
  expectFailureEvidenceKept();
  expect(JSON.parse(fs.readFileSync(REPORT_FILE, 'utf8'))).toMatchObject({
    status: 'incomplete: language-key drift comparison failed',
    retainedOwnRunLangKeyCount: 0, retainedOwnRunLangKeys: [],
  });
});

test('an unchanged run still records and prints a zero retained count', async () => {
  prepareOwnedRunWithKeyDrift('existing_key');
  cleanupMocks.readLangKeyInventoryWithStorageState.mockResolvedValue({ allLangKeys: ['existing_key'], totalLangKeyCount: 1 });
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  await expect(globalTeardown(ownedRunConfig)).resolves.toBeUndefined();
  expect(log).toHaveBeenCalledWith(expect.stringContaining('count=0; names=none'));
  expect(JSON.parse(fs.readFileSync(REPORT_FILE, 'utf8')).retainedOwnRunLangKeyCount).toBe(0);
});

test.each([
  'unavailable source inventory',
  'Malformed JSON response',
  'Incomplete or malformed language-key source inventory',
])('a source-read failure reports unverified candidates and still fails: %s', async (reason) => {
  prepareOwnedRunWithKeyDrift(retainedKey);
  const otherOwnKey = 'search_for_e2e_owned_dataset';
  cleanupMocks.readLangKeyInventoryWithStorageState.mockResolvedValue({
    allLangKeys: ['existing_key', retainedKey, otherOwnKey, 'unrelated_key'], totalLangKeyCount: 4,
  });
  const failure = new Error(reason);
  sourceMocks.readLangKeySourcesWithStorageState.mockRejectedValueOnce(failure);
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  await expect(globalTeardown(ownedRunConfig)).rejects.toBe(failure);
  expectFailureEvidenceKept();
  expect(JSON.parse(fs.readFileSync(REPORT_FILE, 'utf8'))).toMatchObject({
    runId: 'run-own', status: 'incomplete: language-key source read failed',
    retainedOwnRunLangKeyCount: 0, retainedOwnRunLangKeys: [],
    unverifiedOwnRunLangKeys: [retainedKey, otherOwnKey],
  });
  expect(log).toHaveBeenCalledWith(expect.stringContaining(
    `count=0; names=none; status=incomplete: language-key source read failed; unverified=${retainedKey}, ${otherOwnKey}`,
  ));
});

/** Creates real ownership evidence so preservation is checked beyond registry mocks. */
async function prepareCompletedOwnershipHistory() {
  const { readCompletedDatasetNames } = await vi.importActual<typeof import('./test-artifact-dataset-history')>(
    './test-artifact-dataset-history',
  );
  const runDirectory = path.join(AUTH_DIRECTORY, 'artifact-runs', 'run-own');
  const historyDirectory = path.join(runDirectory, 'dataset-history');
  const digest = createHash('sha256').update('dataset\0e2e_owned_dataset').digest('hex');
  const historyFile = path.join(historyDirectory, `${digest}.json`);
  fs.mkdirSync(historyDirectory, { recursive: true });
  fs.writeFileSync(historyFile, JSON.stringify({
    runId: 'run-own', kind: 'dataset', name: 'e2e_owned_dataset', status: 'confirmed', serverId: 17,
  }));
  historyMocks.readCompletedDatasetNames.mockImplementationOnce(readCompletedDatasetNames);
  registryMocks.finishArtifactRunRegistry.mockImplementationOnce(() => {
    fs.rmSync(runDirectory, { recursive: true, force: true });
  });
  return { runDirectory, historyFile, readCompletedDatasetNames };
}

test.each([false, true])('completed ownership history survives reporting and failed runs (source read fails: %s)', async (readFails) => {
  prepareOwnedRunWithKeyDrift(retainedKey);
  registryMocks.listRegisteredTestArtifacts.mockReturnValue([]);
  const { runDirectory, historyFile, readCompletedDatasetNames } = await prepareCompletedOwnershipHistory();
  if (readFails) {
    sourceMocks.readLangKeySourcesWithStorageState.mockRejectedValueOnce(new Error('source read failed'));
  } else {
    sourceMocks.readLangKeySourcesWithStorageState.mockResolvedValueOnce(new Map([[retainedKey, []]]));
  }

  const log = vi.spyOn(console, 'log').mockImplementation((message) => {
    if (String(message).startsWith('[global-teardown] retained own-run language keys:')) {
      expect(fs.existsSync(REPORT_FILE)).toBe(true);
      expect(readCompletedDatasetNames(runDirectory, 'run-own')).toEqual(['e2e_owned_dataset']);
      expect(fs.existsSync(BASELINE_FILE)).toBe(true);
      expect(registryMocks.finishArtifactRunRegistry).not.toHaveBeenCalled();
    }
  });
  if (readFails) {
    await expect(globalTeardown(ownedRunConfig)).rejects.toThrow('source read failed');
  } else {
    await expect(globalTeardown(ownedRunConfig)).resolves.toBeUndefined();
  }
  expect(log).toHaveBeenCalledWith(expect.stringContaining(`report=${REPORT_FILE}`));
  if (readFails) {
    expectFailureEvidenceKept(false, true);
  } else {
    expect(registryMocks.finishArtifactRunRegistry).toHaveBeenCalledWith('run-own');
  }
  expect(fs.existsSync(historyFile)).toBe(false);
  if (readFails) {
    const archivedRun = path.join(runtime.root, 'e2e', 'lang-key-retention', 'run-own.evidence');
    expect(readCompletedDatasetNames(archivedRun, 'run-own')).toEqual(['e2e_owned_dataset']);
  }
  expect(fs.existsSync(BASELINE_FILE)).toBe(readFails);
  expect(storageMocks.removeStorageStateFile).toHaveBeenCalledTimes(1);
});

test('an inventory-read failure is reported and keeps the evidence', async () => {
  prepareOwnedRunWithKeyDrift(retainedKey);
  const failure = new Error('inventory unavailable');
  cleanupMocks.readLangKeyInventoryWithStorageState.mockRejectedValueOnce(failure);
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  await expect(globalTeardown(ownedRunConfig)).rejects.toBe(failure);
  expectFailureEvidenceKept();
  expect(JSON.parse(fs.readFileSync(REPORT_FILE, 'utf8'))).toMatchObject({
    status: 'incomplete: language-key inventory read failed',
    retainedOwnRunLangKeyCount: 0, retainedOwnRunLangKeys: [], unverifiedOwnRunLangKeys: [],
  });
  expect(log).toHaveBeenCalledWith(expect.stringContaining('status=incomplete: language-key inventory read failed'));
});

function expectIncompleteCleanupReport(log: unknown, historyFile: string, emptyRegistry = false, confirmedCleanup = false) {
  expectFailureEvidenceKept(confirmedCleanup, emptyRegistry || confirmedCleanup);
  const evidenceHistory = emptyRegistry || confirmedCleanup
    ? path.join(runtime.root, 'e2e', 'lang-key-retention', 'run-own.evidence', 'dataset-history', path.basename(historyFile))
    : historyFile;
  expect(fs.existsSync(evidenceHistory)).toBe(true);
  expect(JSON.parse(fs.readFileSync(REPORT_FILE, 'utf8'))).toMatchObject({
    status: 'incomplete: artifact cleanup failed', retainedOwnRunLangKeyCount: 0,
    retainedOwnRunLangKeys: [], unverifiedOwnRunLangKeys: [],
  });
  expect(log).toHaveBeenCalledWith(expect.stringContaining(
    'count=0; names=none; status=incomplete: artifact cleanup failed; unverified=none',
  ));
  expect(cleanupMocks.readLangKeyInventoryWithStorageState).not.toHaveBeenCalled();
  expect(sourceMocks.readLangKeySourcesWithStorageState).not.toHaveBeenCalled();
}

test('cleanup rejection reports incomplete, preserves ownership and propagates the original failure', async () => {
  prepareOwnedRunWithKeyDrift(retainedKey);
  const { historyFile } = await prepareCompletedOwnershipHistory();
  const failure = new Error('cleanup rejected');
  cleanupMocks.cleanupSyntheticTestArtifactsWithStorageState.mockRejectedValueOnce(failure);
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  await expect(globalTeardown(ownedRunConfig)).rejects.toBe(failure);
  expectIncompleteCleanupReport(log, historyFile);
});

test.each([false, true])('cleanup internal inventory failure is reported (empty registry: %s)', async (emptyRegistry) => {
  prepareOwnedRunWithKeyDrift(retainedKey);
  const { historyFile } = await prepareCompletedOwnershipHistory();
  if (emptyRegistry) registryMocks.listRegisteredTestArtifacts.mockReturnValue([]);
  const actual = await vi.importActual<typeof import('./test-artifact-cleanup')>('./test-artifact-cleanup');
  const api = fakeApi(emptyRegistry ? {} : { e2e_owned_dataset: { uid: 17 } });
  const get = api.get.getMockImplementation()!;
  api.get.mockImplementation(async (url, options) => {
    // Exercise the real inventory reader in each cleanup branch, without sockets.
    if (url === '/api/translations?lang=en') return response(null);
    return get(url, options);
  });
  const dispose = vi.fn().mockResolvedValue(undefined);
  vi.spyOn(playwrightRequest, 'newContext').mockResolvedValue(Object.assign(api.request, { dispose }));
  let originalFailure: unknown;
  cleanupMocks.cleanupSyntheticTestArtifactsWithStorageState.mockImplementationOnce(async (
    ...args: Parameters<typeof actual.cleanupSyntheticTestArtifactsWithStorageState>
  ) => {
    try {
      return await actual.cleanupSyntheticTestArtifactsWithStorageState(...args);
    } catch (error) {
      originalFailure = error;
      throw error;
    }
  });
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  const failure = await globalTeardown(ownedRunConfig).catch(error => error);
  expect(failure).toBeInstanceOf(Error);
  expect(failure.message).toBe('Malformed translations inventory response.');
  expect(failure).toBe(originalFailure);
  expect(api.get).toHaveBeenCalledWith('/api/translations?lang=en');
  expect(dispose).toHaveBeenCalledTimes(1);
  if (emptyRegistry) {
    expect(api.post).not.toHaveBeenCalled();
  } else {
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(Object.keys(api.datasets)).toEqual([]);
  }
  expectIncompleteCleanupReport(log, historyFile, emptyRegistry, !emptyRegistry);
});

test('cleanup survivors report incomplete and stop before language-key attribution', async () => {
  prepareOwnedRunWithKeyDrift(retainedKey);
  const { historyFile } = await prepareCompletedOwnershipHistory();
  cleanupMocks.cleanupSyntheticTestArtifactsWithStorageState.mockResolvedValueOnce({
    deletedDatasets: [], deletedFolders: [], remainingDatasetNames: ['e2e_owned_dataset'], remainingFolderNames: [],
  });
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  await expect(globalTeardown(ownedRunConfig)).rejects.toThrow('cleanup left artifacts behind');
  expectIncompleteCleanupReport(log, historyFile);
});

test('a drift failure clears accepted keys and reports incomplete without discarding ownership', async () => {
  prepareOwnedRunWithKeyDrift(retainedKey);
  cleanupMocks.readLangKeyInventoryWithStorageState.mockResolvedValueOnce({
    allLangKeys: ['existing_key', retainedKey, 'unrelated_key'], totalLangKeyCount: 3,
  });
  sourceMocks.readLangKeySourcesWithStorageState.mockResolvedValueOnce(new Map([[retainedKey, []]]));
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  await expect(globalTeardown(ownedRunConfig)).rejects.toThrow('added=unrelated_key');
  expectFailureEvidenceKept();
  expect(JSON.parse(fs.readFileSync(REPORT_FILE, 'utf8'))).toMatchObject({
    status: 'incomplete: language-key drift comparison failed', retainedOwnRunLangKeyCount: 0,
    retainedOwnRunLangKeys: [], unverifiedOwnRunLangKeys: [],
  });
  expect(log).toHaveBeenCalledWith(expect.stringContaining(
    'count=0; names=none; status=incomplete: language-key drift comparison failed',
  ));
});

test('a reporting failure cannot replace the original cleanup failure', async () => {
  prepareOwnedRunWithKeyDrift(retainedKey);
  const failure = new Error('cleanup rejected');
  cleanupMocks.cleanupSyntheticTestArtifactsWithStorageState.mockRejectedValueOnce(failure);
  fs.mkdirSync(path.dirname(REPORT_FILE), { recursive: true });
  fs.writeFileSync(REPORT_FILE, 'previous report');
  const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await expect(globalTeardown(ownedRunConfig)).rejects.toBe(failure);
  expectFailureEvidenceKept(false);
  expect(fs.readFileSync(REPORT_FILE, 'utf8')).toBe('previous report');
  expect(log).toHaveBeenCalledWith(expect.stringContaining('retention reporting also failed'));
});

test('a report-write failure preserves ownership evidence and baseline for inspection', async () => {
  prepareOwnedRunWithKeyDrift(retainedKey);
  sourceMocks.readLangKeySourcesWithStorageState.mockResolvedValueOnce(new Map([[retainedKey, []]]));
  fs.mkdirSync(path.dirname(REPORT_FILE), { recursive: true });
  fs.writeFileSync(REPORT_FILE, 'previous report');
  await expect(globalTeardown(ownedRunConfig)).rejects.toMatchObject({ code: 'EEXIST' });
  expect(fs.readFileSync(REPORT_FILE, 'utf8')).toBe('previous report');
  expect(registryMocks.unregisterTestArtifact).toHaveBeenCalledWith('dataset', 'e2e_owned_dataset', 'run-own');
  expect(registryMocks.finishArtifactRunRegistry).not.toHaveBeenCalled();
  expect(fs.existsSync(BASELINE_FILE)).toBe(true);
  expect(storageMocks.removeStorageStateFile).toHaveBeenCalledTimes(1);
});
