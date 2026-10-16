/**
 * global-teardown-finalization.test.ts
 * Proves late teardown failures replace accepted retention evidence exactly once.
 * Connects injected finalization errors to real disposable report files and logs.
 * Keeps the first finalization error authoritative even when reporting also fails.
 */
// @vitest-environment node
import type { FullConfig } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'node:path';
import { afterAll, afterEach, beforeEach, expect, test, vi } from 'vitest';

const runtime = vi.hoisted(() => {
  const previous = process.env.FILTEREST_TEST_RUNTIME_ROOT;
  const root = `/tmp/filterest-teardown-finalization-${process.pid}`;
  process.env.FILTEREST_TEST_RUNTIME_ROOT = root;
  return { root, previous };
});
const calls = vi.hoisted(() => ({
  cleanup: vi.fn(), inventory: vi.fn(), sources: vi.fn(), finish: vi.fn(), removeAuth: vi.fn(),
}));
vi.mock('fs', async (importOriginal) => ({ ...await importOriginal<typeof import('fs')>() }));
vi.mock('./test-artifact-cleanup', async (importOriginal) => ({
  ...await importOriginal<typeof import('./test-artifact-cleanup')>(),
  cleanupSyntheticTestArtifactsWithStorageState: calls.cleanup,
  readLangKeyInventoryWithStorageState: calls.inventory,
}));
vi.mock('./test-artifact-run-registry', async (importOriginal) => ({
  ...await importOriginal<typeof import('./test-artifact-run-registry')>(),
  finishArtifactRunRegistry: calls.finish,
}));
vi.mock('./storage-state-file', () => ({ removeStorageStateFile: calls.removeAuth }));
vi.mock('./lang-key-source-inventory', () => ({ readLangKeySourcesWithStorageState: calls.sources }));

import globalTeardown from '../global-teardown';
import {
  confirmTestArtifact, initializeArtifactRunRegistry, registerTestArtifact, unregisterTestArtifact,
} from './test-artifact-run-registry';

const authDirectory = path.join(runtime.root, 'e2e', '.auth');
const registryRoot = path.join(authDirectory, 'artifact-runs');
const runId = 'run-finalization-proof';
const runDirectory = path.join(registryRoot, runId);
const reportFile = path.join(runtime.root, 'e2e', 'lang-key-retention', `${runId}.json`);
const evidenceDirectory = path.join(path.dirname(reportFile), `${runId}.evidence`);
const baselineFile = path.join(authDirectory, 'artifact-baseline.json');
const retainedKey = 'add_row_e2e_finalization_proof';
const baseURL = 'https://example.invalid';
const config = { projects: [{ use: { baseURL } }] } as unknown as FullConfig;

beforeEach(() => {
  fs.rmSync(runtime.root, { recursive: true, force: true });
  vi.resetAllMocks();
  initializeArtifactRunRegistry({ rootDirectory: registryRoot, runId });
  registerTestArtifact('dataset', 'e2e_finalization_proof');
  confirmTestArtifact('dataset', 'e2e_finalization_proof', 17);
  unregisterTestArtifact('dataset', 'e2e_finalization_proof');
  fs.writeFileSync(path.join(authDirectory, 'user.json'), '{}');
  fs.writeFileSync(baselineFile, JSON.stringify({
    runId, baseURL, userId: 4, username: 'test_admin', datasets: [], folders: [],
    langKeys: ['existing'], totalLangKeyCount: 1, capturedAt: '2026-10-16T00:00:00.000Z',
  }));
  calls.cleanup.mockResolvedValue({ deletedDatasets: [], deletedFolders: [],
    remainingDatasetNames: [], remainingFolderNames: [] });
  calls.inventory.mockResolvedValue({ allLangKeys: ['existing', retainedKey], totalLangKeyCount: 2 });
  calls.sources.mockResolvedValue(new Map([[retainedKey, []]]));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(runtime.root, { recursive: true, force: true });
});
afterAll(() => {
  if (runtime.previous === undefined) delete process.env.FILTEREST_TEST_RUNTIME_ROOT;
  else process.env.FILTEREST_TEST_RUNTIME_ROOT = runtime.previous;
});

/** Observes only this run's report writes, optionally rejecting the single rewrite. */
function observeReportWrites(rewriteError?: Error) {
  const actualWrite = fs.writeFileSync;
  return vi.spyOn(fs, 'writeFileSync').mockImplementation((file, data, options) => {
    if (String(file) === reportFile && fs.existsSync(reportFile) && rewriteError) throw rewriteError;
    return actualWrite(file, data, options);
  });
}

function expectFinalReport(stage: string, writes: ReturnType<typeof observeReportWrites>) {
  expect(JSON.parse(fs.readFileSync(reportFile, 'utf8'))).toMatchObject({
    runId, status: `incomplete: ${stage} failed`, retainedOwnRunLangKeyCount: 0,
    retainedOwnRunLangKeys: [], unverifiedOwnRunLangKeys: [retainedKey],
  });
  expect(console.log).toHaveBeenLastCalledWith(expect.stringContaining(
    `count=0; names=none; status=incomplete: ${stage} failed; unverified=${retainedKey}; report=${reportFile}`,
  ));
  expect(writes.mock.calls.filter(([file]) => String(file) === reportFile)).toHaveLength(2);
  expect(console.log).toHaveBeenCalledTimes(2);
}

test('registry release failure rewrites and logs zero accepted keys, then rethrows that error', async () => {
  const original = new Error('registry release unavailable');
  calls.finish.mockImplementationOnce(() => {
    expect(JSON.parse(fs.readFileSync(reportFile, 'utf8')).status).toBe('complete');
    expect(console.log).toHaveBeenLastCalledWith(expect.stringContaining(`count=1; names=${retainedKey}`));
    expect(fs.existsSync(runDirectory)).toBe(true);
    expect(fs.existsSync(baselineFile)).toBe(true);
    throw original;
  });
  const writes = observeReportWrites();
  await expect(globalTeardown(config)).rejects.toBe(original);
  expectFinalReport('registry release', writes);
  expect(calls.finish).toHaveBeenCalledTimes(1);
  expect(calls.removeAuth).toHaveBeenCalledTimes(1);
});

test.each(['directory creation', 'registry copy', 'baseline copy'])(
  'evidence archive failure during %s rewrites and logs the report and rethrows the archive error', async (step) => {
    // Archival is only attempted for an already incomplete run.
    if (step === 'registry copy') {
      calls.inventory.mockResolvedValueOnce({
        allLangKeys: ['existing', retainedKey, 'unrelated'], totalLangKeyCount: 3,
      });
    } else {
      calls.sources.mockRejectedValueOnce(new Error('source read unavailable'));
    }
    const original = new Error('evidence archive unavailable');
    if (step === 'directory creation') {
      const mkdir = fs.mkdirSync;
      vi.spyOn(fs, 'mkdirSync').mockImplementation((directory, options) => {
        if (String(directory) === evidenceDirectory) throw original;
        return mkdir(directory, options);
      });
    } else if (step === 'registry copy') {
      vi.spyOn(fs, 'cpSync').mockImplementationOnce(() => { throw original; });
    } else {
      vi.spyOn(fs, 'copyFileSync').mockImplementationOnce(() => { throw original; });
    }
    const writes = observeReportWrites();
    await expect(globalTeardown(config)).rejects.toBe(original);
    expectFinalReport('evidence archive', writes);
    expect(calls.finish).not.toHaveBeenCalled();
    expect(fs.existsSync(runDirectory)).toBe(true);
    expect(fs.existsSync(baselineFile)).toBe(true);
  },
);

test('auth-file removal failure rewrites and logs zero accepted keys, then rethrows that error', async () => {
  const original = new Error('auth-file removal unavailable');
  calls.removeAuth.mockImplementationOnce(() => { throw original; });
  const writes = observeReportWrites();
  await expect(globalTeardown(config)).rejects.toBe(original);
  expectFinalReport('auth-state removal', writes);
  expect(calls.finish).toHaveBeenCalledTimes(1);
  expect(calls.removeAuth).toHaveBeenCalledTimes(1);
});

test('auth-file removal failure replaces an already incomplete report and rethrows the auth error', async () => {
  calls.sources.mockRejectedValueOnce(new Error('source read unavailable'));
  const original = new Error('auth-file removal unavailable');
  calls.removeAuth.mockImplementationOnce(() => { throw original; });
  const writes = observeReportWrites();
  await expect(globalTeardown(config)).rejects.toBe(original);
  expectFinalReport('auth-state removal', writes);
});

test.each(['registry release', 'auth-state removal'])(
  '%s error survives a failed rewrite with no retry', async (stage) => {
    const original = new Error(`${stage} unavailable`);
    const boundary = stage === 'registry release' ? calls.finish : calls.removeAuth;
    boundary.mockImplementationOnce(() => { throw original; });
    const writes = observeReportWrites(new Error('rewrite unavailable'));
    await expect(globalTeardown(config)).rejects.toBe(original);
    expect(writes.mock.calls.filter(([file]) => String(file) === reportFile)).toHaveLength(2);
    expect(JSON.parse(fs.readFileSync(reportFile, 'utf8')).status).toBe('complete');
    expect(console.log).toHaveBeenCalledTimes(1);
  },
);

test.each([false, true])('later auth failure cannot replace the release error or retry its rewrite (rewrite fails: %s)', async (rewriteFails) => {
  const original = new Error('registry release unavailable');
  calls.finish.mockImplementationOnce(() => { throw original; });
  calls.removeAuth.mockImplementationOnce(() => { throw new Error('auth-file removal unavailable'); });
  const writes = observeReportWrites(rewriteFails ? new Error('rewrite unavailable') : undefined);
  await expect(globalTeardown(config)).rejects.toBe(original);
  expect(writes.mock.calls.filter(([file]) => String(file) === reportFile)).toHaveLength(2);
  if (!rewriteFails) expectFinalReport('registry release', writes);
});
