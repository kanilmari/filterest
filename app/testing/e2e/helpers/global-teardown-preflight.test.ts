/**
 * global-teardown-preflight.test.ts
 * Proves owned-run preflight failures report zero accepted keys before cleanup.
 * Connects real baseline/registry/history validation with isolated API boundaries.
 * Keeps original errors and evidence, while foreign processes touch nothing.
 */
// @vitest-environment node
import type { FullConfig } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterAll, afterEach, beforeEach, expect, test, vi } from 'vitest';

const runtime = vi.hoisted(() => {
  const previous = process.env.FILTEREST_TEST_RUNTIME_ROOT;
  const root = `/tmp/filterest-teardown-preflight-${process.pid}`;
  process.env.FILTEREST_TEST_RUNTIME_ROOT = root;
  return { root, previous };
});
const calls = vi.hoisted(() => ({
  cleanup: vi.fn(), inventory: vi.fn(), sources: vi.fn(), validate: vi.fn(),
  list: vi.fn(), history: vi.fn(), finish: vi.fn(), unregister: vi.fn(), removeAuth: vi.fn(),
}));
vi.mock('./test-artifact-cleanup', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./test-artifact-cleanup')>();
  return { ...actual, cleanupSyntheticTestArtifactsWithStorageState: calls.cleanup,
    readLangKeyInventoryWithStorageState: calls.inventory,
    validateSyntheticArtifactBaseline: calls.validate.mockImplementation(actual.validateSyntheticArtifactBaseline) };
});
vi.mock('./test-artifact-run-registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./test-artifact-run-registry')>();
  return { ...actual, listRegisteredTestArtifacts: calls.list.mockImplementation(actual.listRegisteredTestArtifacts),
    finishArtifactRunRegistry: calls.finish.mockImplementation(actual.finishArtifactRunRegistry),
    unregisterTestArtifact: calls.unregister.mockImplementation(actual.unregisterTestArtifact) };
});
vi.mock('./test-artifact-dataset-history', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./test-artifact-dataset-history')>();
  return { ...actual, readCompletedDatasetNames: calls.history.mockImplementation(actual.readCompletedDatasetNames) };
});
vi.mock('./storage-state-file', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./storage-state-file')>();
  return { ...actual, removeStorageStateFile: calls.removeAuth.mockImplementation(actual.removeStorageStateFile) };
});
vi.mock('./lang-key-source-inventory', () => ({ readLangKeySourcesWithStorageState: calls.sources }));

import globalTeardown from '../global-teardown';
import {
  confirmTestArtifact, initializeArtifactRunRegistry, registerTestArtifact, unregisterTestArtifact,
} from './test-artifact-run-registry';

const authDirectory = path.join(runtime.root, 'e2e', '.auth');
const registryRoot = path.join(authDirectory, 'artifact-runs');
const runId = 'run-preflight-proof';
const runDirectory = path.join(registryRoot, runId);
const historyDirectory = path.join(runDirectory, 'dataset-history');
const baselineFile = path.join(authDirectory, 'artifact-baseline.json');
const authFile = path.join(authDirectory, 'user.json');
const reportDirectory = path.join(runtime.root, 'e2e', 'lang-key-retention');
const reportFile = path.join(reportDirectory, `${runId}.json`);
const baseURL = 'https://example.invalid';
const config = { projects: [{ use: { baseURL } }] } as unknown as FullConfig;
const baseline = { runId, baseURL, userId: 4, username: 'test_admin', datasets: [], folders: [],
  langKeys: ['existing'], totalLangKeyCount: 1, capturedAt: '2026-10-16T00:00:00.000Z' };

/** Snapshots only this test's disposable evidence, including directory entries. */
function snapshot(directory: string): unknown {
  return fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
    .map(entry => [entry.name, entry.isDirectory()
      ? snapshot(path.join(directory, entry.name)) : fs.readFileSync(path.join(directory, entry.name), 'utf8')]);
}

beforeEach(() => {
  fs.rmSync(runtime.root, { recursive: true, force: true });
  vi.clearAllMocks();
  initializeArtifactRunRegistry({ rootDirectory: registryRoot, runId });
  fs.mkdirSync(historyDirectory);
  fs.writeFileSync(authFile, '{}');
  fs.writeFileSync(baselineFile, JSON.stringify(baseline));
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

const preflightCases = [
  ['history read failure', 'completed dataset history read failed', 'history unavailable', 'history'],
  ['unreadable history', 'completed dataset history read failed', 'Unreadable E2E dataset history', 'history'],
  ['malformed history', 'completed dataset history read failed', 'Invalid E2E dataset history', 'history'],
  ['ambiguous planned entry', 'planned artifact validation failed', 'ambiguous planned artifacts', undefined],
  ['registry validation failure', 'artifact registry validation failed', 'Unexpected entry in E2E artifact run', 'list'],
  ['baseline validation failure', 'artifact baseline validation failed', 'baseline is incomplete', 'validate'],
  ['missing baseline', 'artifact baseline validation failed', 'missing artifact baseline', undefined],
  ['unreadable baseline', 'artifact baseline validation failed', 'EISDIR', undefined],
  ['unparseable baseline', 'artifact baseline validation failed', 'JSON', undefined],
  ['baseline run mismatch', 'artifact baseline validation failed', 'does not match registry run', undefined],
  ['baseline target mismatch', 'artifact baseline validation failed', 'does not match configured target', undefined],
  ['target resolution failure', 'target resolution failed', 'target unavailable', undefined],
  ['missing authentication', 'authenticated storage state validation failed', 'missing authenticated storage state', undefined],
] as const;

test.each(preflightCases)('%s reports zero accepted keys and preserves every evidence file', async (step, reason, message, boundary) => {
  const original = new Error(message);
  let input = config;
  if (step === 'history read failure') calls.history.mockImplementationOnce(() => { throw original; });
  if (step === 'unreadable history') fs.writeFileSync(path.join(historyDirectory, 'broken.json'), '{');
  if (step === 'malformed history') fs.writeFileSync(path.join(historyDirectory, 'broken.json'), '{}');
  if (step === 'ambiguous planned entry') registerTestArtifact('dataset', 'e2e_planned_preflight');
  if (step === 'registry validation failure') fs.writeFileSync(path.join(runDirectory, 'unexpected.json'), '{}');
  if (step === 'baseline validation failure') fs.writeFileSync(baselineFile, '{}');
  if (step === 'missing baseline') fs.rmSync(baselineFile);
  if (step === 'unreadable baseline') { fs.rmSync(baselineFile); fs.mkdirSync(baselineFile); }
  if (step === 'unparseable baseline') fs.writeFileSync(baselineFile, '{');
  if (step === 'baseline run mismatch') fs.writeFileSync(baselineFile, JSON.stringify({ ...baseline, runId: 'run-other' }));
  if (step === 'baseline target mismatch') fs.writeFileSync(baselineFile, JSON.stringify({ ...baseline, baseURL: 'https://other.invalid' }));
  if (step === 'target resolution failure') input = { get projects() { throw original; } } as FullConfig;
  if (step === 'missing authentication') fs.rmSync(authFile);
  const evidenceBefore = snapshot(registryRoot);
  const baselineBefore = fs.existsSync(baselineFile) && fs.statSync(baselineFile).isFile()
    ? fs.readFileSync(baselineFile, 'utf8') : null;

  const failure = await globalTeardown(input).catch(error => error);
  expect(failure).toBeInstanceOf(Error);
  expect(failure.message).toContain(message);
  if (boundary) expect(failure).toBe(calls[boundary].mock.results.find(result => result.type === 'throw')?.value);
  if (step === 'history read failure' || step === 'target resolution failure') expect(failure).toBe(original);
  expect(JSON.parse(fs.readFileSync(reportFile, 'utf8'))).toMatchObject({
    runId, status: `incomplete: ${reason}`, retainedOwnRunLangKeyCount: 0,
    retainedOwnRunLangKeys: [], unverifiedOwnRunLangKeys: [],
  });
  expect(console.log).toHaveBeenCalledWith(expect.stringContaining(`count=0; names=none; status=incomplete: ${reason}`));
  expect(snapshot(registryRoot)).toEqual(evidenceBefore);
  if (baselineBefore !== null) expect(fs.readFileSync(baselineFile, 'utf8')).toBe(baselineBefore);
  expect(fs.existsSync(path.join(reportDirectory, `${runId}.evidence`))).toBe(false);
  for (const call of [calls.cleanup, calls.inventory, calls.sources, calls.unregister, calls.finish]) {
    expect(call).not.toHaveBeenCalled();
  }
  // Even an empty registry must stay active when preflight never authorized cleanup.
  expect(calls.list).toHaveBeenCalledTimes(boundary === 'list' || boundary === 'history'
    || step === 'ambiguous planned entry' ? 1 : 0);
});

test.each(['different PID', 'different nonce'])('a foreign process (%s) writes no report and touches nothing', async (kind) => {
  const descriptorFile = path.join(runDirectory, 'run.json');
  const pointerFile = path.join(registryRoot, 'current-run.json');
  for (const file of [descriptorFile, pointerFile]) {
    const entry = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (kind === 'different PID') entry.pid += 1;
    else entry.processNonce = entry.processNonce === 'a'.repeat(64) ? 'b'.repeat(64) : 'a'.repeat(64);
    fs.writeFileSync(file, JSON.stringify(entry));
  }
  const before = snapshot(runtime.root);
  // A target getter would throw if any owned-run preflight were reached.
  const input = { get projects() { throw new Error('foreign target was read'); } } as FullConfig;
  await expect(globalTeardown(input)).rejects.toThrow('belongs to another process identity');
  expect(snapshot(runtime.root)).toEqual(before);
  expect(fs.existsSync(reportDirectory)).toBe(false);
  expect(console.log).not.toHaveBeenCalled();
  for (const call of Object.values(calls)) expect(call).not.toHaveBeenCalled();
});

test('preflight failure retains active confirmed artifacts as well as completed history', async () => {
  registerTestArtifact('dataset', 'e2e_completed_preflight');
  confirmTestArtifact('dataset', 'e2e_completed_preflight', 18);
  unregisterTestArtifact('dataset', 'e2e_completed_preflight');
  calls.unregister.mockClear();
  registerTestArtifact('dataset', 'e2e_confirmed_preflight');
  confirmTestArtifact('dataset', 'e2e_confirmed_preflight', 17);
  const before = snapshot(registryRoot);
  const original = new Error('history unavailable');
  calls.history.mockImplementationOnce(() => { throw original; });
  await expect(globalTeardown(config)).rejects.toBe(original);
  expect(JSON.parse(fs.readFileSync(reportFile, 'utf8')).retainedOwnRunLangKeyCount).toBe(0);
  expect(snapshot(registryRoot)).toEqual(before);
  expect(calls.cleanup).not.toHaveBeenCalled();
  expect(calls.unregister).not.toHaveBeenCalled();
  expect(calls.finish).not.toHaveBeenCalled();
});

test('secondary report and auth-removal failures cannot replace the original preflight error', async () => {
  const original = new Error('history unavailable');
  calls.history.mockImplementationOnce(() => { throw original; });
  calls.removeAuth.mockImplementationOnce(() => { throw new Error('auth removal failed'); });
  fs.mkdirSync(reportDirectory, { recursive: true });
  fs.writeFileSync(reportFile, 'existing evidence');
  const before = snapshot(runtime.root);
  await expect(globalTeardown(config)).rejects.toBe(original);
  expect(snapshot(runtime.root)).toEqual(before);
  expect(console.error).toHaveBeenCalledWith(expect.stringContaining('retention reporting also failed'));
  expect(console.error).toHaveBeenCalledWith(expect.stringContaining('auth-state removal also failed'));
  expect(calls.finish).not.toHaveBeenCalled();
});
