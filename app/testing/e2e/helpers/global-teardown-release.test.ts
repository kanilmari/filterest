/**
 * Proves failed teardown releases confirmed cleanup without blocking the next run.
 * Connects real filesystem ownership/history and startup to isolated API results.
 * Keeps unconfirmed leftovers and failed-run diagnostic evidence distinguishable.
 */
// @vitest-environment node
import { request as playwrightRequest, type FullConfig } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterAll, beforeEach, expect, test, vi } from 'vitest';

const runtime = vi.hoisted(() => {
  const previous = process.env.FILTEREST_TEST_RUNTIME_ROOT;
  const root = `/tmp/filterest-teardown-release-${process.pid}`;
  process.env.FILTEREST_TEST_RUNTIME_ROOT = root;
  return { root, previous };
});
const api = vi.hoisted(() => ({ cleanup: vi.fn(), inventory: vi.fn(), sources: vi.fn() }));
vi.mock('./test-artifact-cleanup', async (importOriginal) => ({
  ...await importOriginal<typeof import('./test-artifact-cleanup')>(),
  cleanupSyntheticTestArtifactsWithStorageState: async (
    ...args: Parameters<typeof import('./test-artifact-cleanup').cleanupSyntheticTestArtifactsWithStorageState>
  ) => {
    const summary = await api.cleanup(...args);
    for (const artifact of args[3]) {
      const deleted = artifact.kind === 'dataset' ? summary.deletedDatasets : summary.deletedFolders;
      const remaining = artifact.kind === 'dataset' ? summary.remainingDatasetNames : summary.remainingFolderNames;
      if (deleted.includes(artifact.name) && !remaining.includes(artifact.name)) args[4]?.(artifact);
    }
    return summary;
  },
  readLangKeyInventoryWithStorageState: api.inventory,
}));
vi.mock('./lang-key-source-inventory', () => ({ readLangKeySourcesWithStorageState: api.sources }));

import globalTeardown from '../global-teardown';
import {
  confirmTestArtifact, getCurrentArtifactRun, initializeArtifactRunRegistry,
  listRegisteredTestArtifacts, registerTestArtifact, unregisterTestArtifact,
} from './test-artifact-run-registry';
import { initializeArtifactRunRegistryWithRecovery } from './test-artifact-stale-run-recovery';
import { readCompletedDatasetNames } from './test-artifact-dataset-history';
import { fakeApi, response } from './test-artifact-recovery-fakes';

const authDirectory = path.join(runtime.root, 'e2e', '.auth');
const registryRoot = path.join(authDirectory, 'artifact-runs');
const runId = 'run-release-proof';
const runDirectory = path.join(registryRoot, runId);
const reportDirectory = path.join(runtime.root, 'e2e', 'lang-key-retention');
const reportFile = path.join(reportDirectory, `${runId}.json`);
const evidenceDirectory = path.join(reportDirectory, `${runId}.evidence`);
const baselineFile = path.join(authDirectory, 'artifact-baseline.json');
const baseURL = 'https://example.invalid';
const config = { projects: [{ use: { baseURL } }] } as unknown as FullConfig;
const summary = {
  deletedDatasets: ['e2e_cleanup_confirmed'], deletedFolders: ['e2e_folder_confirmed'], deletedLangKeys: [],
  remainingDatasetNames: [], remainingFolderNames: [], remainingSyntheticLangKeys: [], totalLangKeyCount: 1,
};

beforeEach(() => {
  fs.rmSync(runtime.root, { recursive: true, force: true });
  vi.resetAllMocks();
  initializeArtifactRunRegistry({ rootDirectory: registryRoot, runId });
  for (const [kind, name, id] of [
    ['dataset', 'e2e_cleanup_confirmed', 17], ['folder', 'e2e_folder_confirmed', 18],
    ['dataset', 'e2e_completed_earlier', 19],
  ] as const) {
    registerTestArtifact(kind, name);
    confirmTestArtifact(kind, name, id);
  }
  unregisterTestArtifact('dataset', 'e2e_completed_earlier');
  fs.writeFileSync(path.join(authDirectory, 'user.json'), '{}');
  fs.writeFileSync(baselineFile, JSON.stringify({
    runId, baseURL, userId: 4, username: 'test_admin', datasets: [], folders: [],
    langKeys: ['existing'], totalLangKeyCount: 1, capturedAt: '2026-10-16T00:00:00.000Z',
  }));
  api.cleanup.mockResolvedValue(summary);
  api.inventory.mockResolvedValue({ allLangKeys: ['existing', 'unrelated'], totalLangKeyCount: 2 });
  api.sources.mockResolvedValue(new Map());
});

afterAll(() => {
  fs.rmSync(runtime.root, { recursive: true, force: true });
  if (runtime.previous === undefined) delete process.env.FILTEREST_TEST_RUNTIME_ROOT;
  else process.env.FILTEREST_TEST_RUNTIME_ROOT = runtime.previous;
});

test.each(['drift', 'inventory', 'source'])('confirmed cleanup permits a NEW run after %s failure', async (step) => {
  const failure = new Error(`${step} unavailable`);
  if (step === 'inventory') api.inventory.mockRejectedValueOnce(failure);
  if (step === 'source') api.sources.mockRejectedValueOnce(failure);
  const originalBaseline = fs.readFileSync(baselineFile, 'utf8');
  const failureResult = await globalTeardown(config).catch(error => error);
  if (step === 'drift') expect(failureResult.message).toContain('added=unrelated');
  else expect(failureResult).toBe(failure);

  expect(JSON.parse(fs.readFileSync(reportFile, 'utf8'))).toMatchObject({
    status: expect.stringMatching(/^incomplete:/), retainedOwnRunLangKeyCount: 0, retainedOwnRunLangKeys: [],
  });
  expect(getCurrentArtifactRun()).toBeNull();
  expect(fs.readdirSync(registryRoot)).toEqual([]);
  expect(readCompletedDatasetNames(evidenceDirectory, runId)).toEqual([
    'e2e_cleanup_confirmed', 'e2e_completed_earlier',
  ]);
  expect(fs.readFileSync(path.join(evidenceDirectory, 'artifact-baseline.json'), 'utf8')).toBe(originalBaseline);
  expect(fs.readFileSync(baselineFile, 'utf8')).toBe(originalBaseline);
  const recover = vi.fn();
  const next = await initializeArtifactRunRegistryWithRecovery({ runId: 'run-next-proof' }, recover);
  expect(next.runId).toBe('run-next-proof');
  expect(listRegisteredTestArtifacts()).toEqual([]);
  expect(recover).not.toHaveBeenCalled();
  expect(fs.existsSync(reportFile)).toBe(true);
  expect(readCompletedDatasetNames(evidenceDirectory, runId)).toHaveLength(2);
  // Model setup's normal baseline replacement without loading credentials or logging in.
  fs.writeFileSync(baselineFile, JSON.stringify({ runId: next.runId }));
  expect(fs.readFileSync(path.join(evidenceDirectory, 'artifact-baseline.json'), 'utf8')).toBe(originalBaseline);
});

test('partial cleanup releases only confirmed absences and retains both kinds of survivor', async () => {
  registerTestArtifact('dataset', 'e2e_cleanup_unconfirmed');
  confirmTestArtifact('dataset', 'e2e_cleanup_unconfirmed', 20);
  registerTestArtifact('folder', 'e2e_folder_unconfirmed');
  confirmTestArtifact('folder', 'e2e_folder_unconfirmed', 21);
  api.cleanup.mockResolvedValueOnce({ ...summary,
    // A successful delete response alone is insufficient when the survivor read disagrees.
    deletedDatasets: [...summary.deletedDatasets, 'e2e_cleanup_unconfirmed'],
    deletedFolders: [...summary.deletedFolders, 'e2e_folder_unconfirmed'],
    remainingDatasetNames: ['e2e_cleanup_unconfirmed'], remainingFolderNames: ['e2e_folder_unconfirmed'],
  });
  await expect(globalTeardown(config)).rejects.toThrow('cleanup left artifacts behind');
  expect(listRegisteredTestArtifacts().map(artifact => artifact.name).sort()).toEqual([
    'e2e_cleanup_unconfirmed', 'e2e_folder_unconfirmed',
  ]);
  expect(readCompletedDatasetNames(runDirectory, runId)).toEqual(['e2e_cleanup_confirmed', 'e2e_completed_earlier']);
  expect(getCurrentArtifactRun()?.runId).toBe(runId);
  expect(fs.existsSync(baselineFile)).toBe(true);
  expect(fs.existsSync(reportFile)).toBe(true);
  expect(api.inventory).not.toHaveBeenCalled();
});

test('cleanup rejection has no confirmation and preserves all active entries', async () => {
  const failure = new Error('cleanup unavailable');
  api.cleanup.mockRejectedValueOnce(failure);
  await expect(globalTeardown(config)).rejects.toBe(failure);
  expect(listRegisteredTestArtifacts().map(artifact => artifact.name).sort()).toEqual([
    'e2e_cleanup_confirmed', 'e2e_folder_confirmed',
  ]);
  expect(readCompletedDatasetNames(runDirectory, runId)).toEqual(['e2e_completed_earlier']);
  expect(fs.existsSync(reportFile)).toBe(true);
  expect(fs.existsSync(baselineFile)).toBe(true);
});

test('a real cleanup inventory failure after confirmed absence still permits a NEW run', async () => {
  const actual = await vi.importActual<typeof import('./test-artifact-cleanup')>('./test-artifact-cleanup');
  const server = fakeApi({ e2e_cleanup_confirmed: { uid: 17 } });
  const get = server.get.getMockImplementation()!;
  server.get.mockImplementation(async (url, options) =>
    url === '/api/translations?lang=en' ? response(null) : get(url, options));
  const dispose = vi.fn().mockResolvedValue(undefined);
  const context = vi.spyOn(playwrightRequest, 'newContext')
    .mockResolvedValue(Object.assign(server.request, { dispose }));
  api.cleanup.mockImplementationOnce(actual.cleanupSyntheticTestArtifactsWithStorageState);
  try {
    await expect(globalTeardown(config)).rejects.toThrow('Malformed translations inventory response.');
    expect(Object.keys(server.datasets)).toEqual([]);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(getCurrentArtifactRun()).toBeNull();
    expect(fs.readdirSync(registryRoot)).toEqual([]);
    expect(JSON.parse(fs.readFileSync(reportFile, 'utf8')).status).toBe('incomplete: artifact cleanup failed');
    expect(readCompletedDatasetNames(evidenceDirectory, runId)).toEqual(['e2e_cleanup_confirmed', 'e2e_completed_earlier']);
    const next = await initializeArtifactRunRegistryWithRecovery({ runId: 'run-next-internal' }, vi.fn());
    expect(next.runId).toBe('run-next-internal');
  } finally {
    context.mockRestore();
  }
});

test('a later cleanup verification failure retains only entries without absence proof', async () => {
  registerTestArtifact('dataset', 'e2e_cleanup_unconfirmed');
  confirmTestArtifact('dataset', 'e2e_cleanup_unconfirmed', 20);
  const actual = await vi.importActual<typeof import('./test-artifact-cleanup')>('./test-artifact-cleanup');
  const server = fakeApi({ e2e_cleanup_confirmed: { uid: 17 }, e2e_cleanup_unconfirmed: { uid: 20 } });
  const get = server.get.getMockImplementation()!;
  const post = server.post.getMockImplementation()!;
  server.post.mockImplementation(async (url, options) =>
    url === '/api/delete-folder' ? response({ message: 'folder remains' }, 409) : post(url, options));
  let afterDropTreeReads = 0;
  server.get.mockImplementation(async (url, options) => {
    // Folder cleanup reads first, followed by the two dataset absence checks.
    // Inject the same failed second check in both the old parallel and new sequential code.
    if (url === '/api/tree_data' && Object.keys(server.datasets).length === 0
      && ++afterDropTreeReads === 3) return response({}, 503);
    if (url === '/api/translations?lang=en') return response({ existing: 'Existing' });
    if (url === '/api/tree_data') {
      const tree = await (await get(url, options)).json() as { nodes: unknown[] };
      return response({ nodes: [...tree.nodes,
        { id: 'f_18', db_id: 18, name: 'e2e_folder_confirmed', parent_id: null }] });
    }
    return get(url, options);
  });
  const context = vi.spyOn(playwrightRequest, 'newContext')
    .mockResolvedValue(Object.assign(server.request, { dispose: vi.fn().mockResolvedValue(undefined) }));
  api.cleanup.mockImplementationOnce(actual.cleanupSyntheticTestArtifactsWithStorageState);
  try {
    await expect(globalTeardown(config)).rejects.toThrow(/503/);
    expect(Object.keys(server.datasets)).toEqual([]);
    expect(listRegisteredTestArtifacts().map(artifact => artifact.name).sort()).toEqual([
      'e2e_cleanup_unconfirmed', 'e2e_folder_confirmed',
    ]);
    expect(readCompletedDatasetNames(runDirectory, runId)).toEqual(['e2e_cleanup_confirmed', 'e2e_completed_earlier']);
    expect(getCurrentArtifactRun()?.runId).toBe(runId);
    expect(fs.existsSync(reportFile)).toBe(true);
    expect(fs.existsSync(baselineFile)).toBe(true);
    expect(api.inventory).not.toHaveBeenCalled();
    expect(api.sources).not.toHaveBeenCalled();
  } finally {
    context.mockRestore();
  }
});

test('failed-run evidence is archived only after its report has been written', async () => {
  const observe = vi.spyOn(console, 'log').mockImplementation((message) => {
    if (String(message).includes(`report=${reportFile}`)) {
      expect(fs.existsSync(reportFile)).toBe(true);
      expect(fs.existsSync(runDirectory)).toBe(true);
      expect(readCompletedDatasetNames(runDirectory, runId)).toContain('e2e_completed_earlier');
      expect(fs.existsSync(baselineFile)).toBe(true);
      expect(fs.existsSync(evidenceDirectory)).toBe(false);
    }
  });
  try {
    await expect(globalTeardown(config)).rejects.toThrow('added=unrelated');
    expect(observe).toHaveBeenCalledWith(expect.stringContaining(`report=${reportFile}`));
    expect(fs.existsSync(evidenceDirectory)).toBe(true);
  } finally {
    observe.mockRestore();
  }
});

test('an already absent dataset is released even when another dataset drop fails', async () => {
  registerTestArtifact('dataset', 'e2e_cleanup_unconfirmed');
  confirmTestArtifact('dataset', 'e2e_cleanup_unconfirmed', 20);
  const actual = await vi.importActual<typeof import('./test-artifact-cleanup')>('./test-artifact-cleanup');
  const server = fakeApi({ e2e_cleanup_unconfirmed: { uid: 20 } });
  server.post.mockResolvedValueOnce(response({ message: 'cleanup refused' }, 500));
  const context = vi.spyOn(playwrightRequest, 'newContext')
    .mockResolvedValue(Object.assign(server.request, { dispose: vi.fn().mockResolvedValue(undefined) }));
  api.cleanup.mockImplementationOnce(actual.cleanupSyntheticTestArtifactsWithStorageState);
  try {
    await expect(globalTeardown(config)).rejects.toThrow('cleanup refused');
    expect(listRegisteredTestArtifacts().map(artifact => artifact.name).sort()).toEqual([
      'e2e_cleanup_unconfirmed', 'e2e_folder_confirmed',
    ]);
    expect(readCompletedDatasetNames(runDirectory, runId)).toEqual(['e2e_cleanup_confirmed', 'e2e_completed_earlier']);
    expect(fs.existsSync(baselineFile)).toBe(true);
    expect(fs.existsSync(reportFile)).toBe(true);
  } finally {
    context.mockRestore();
  }
});
