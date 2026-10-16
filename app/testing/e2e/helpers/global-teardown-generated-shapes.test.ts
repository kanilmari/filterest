/**
 * global-teardown-generated-shapes.test.ts
 * Replays native generated-key retention with real disposable run/column history.
 * Connects the complete teardown sequence to exact generated names and reports.
 * Proves every foreign addition, removal and unavailable inventory still fails.
 */
// @vitest-environment node
import type { FullConfig } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterAll, beforeEach, expect, test, vi } from 'vitest';
const runtime = vi.hoisted(() => {
  const previous = process.env.FILTEREST_TEST_RUNTIME_ROOT;
  const root = `/tmp/filterest-generated-shapes-${process.pid}`;
  process.env.FILTEREST_TEST_RUNTIME_ROOT = root;
  return { root, previous };
});
const api = vi.hoisted(() => ({ cleanupSyntheticTestArtifactsWithStorageState: vi.fn(),
  readLangKeyInventoryWithStorageState: vi.fn(), normalizeE2EBaseURL: (value: string) => value,
  validateSyntheticArtifactBaseline: (value: unknown) => value }));
const source = vi.hoisted(() => ({ readLangKeySourcesWithStorageState: vi.fn() }));
vi.mock('./test-artifact-cleanup', () => api);
vi.mock('./lang-key-source-inventory', () => source);
import globalTeardown from '../global-teardown';
import { confirmTestArtifact, initializeArtifactRunRegistry, registerTestArtifact,
  unregisterTestArtifact } from './test-artifact-run-registry';

const runId = 'run-native-generated-shapes';
const auth = path.join(runtime.root, 'e2e', '.auth');
const report = path.join(runtime.root, 'e2e', 'lang-key-retention', `${runId}.json`);
const config = { projects: [{ use: { baseURL: 'https://localhost:9999' } }] } as unknown as FullConfig;
let keys: string[];
beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  fs.rmSync(runtime.root, { recursive: true, force: true });
  const registry = path.join(auth, 'artifact-runs');
  initializeArtifactRunRegistry({ rootDirectory: registry, runId });
  fs.writeFileSync(path.join(auth, 'user.json'), '{}');
  fs.writeFileSync(path.join(auth, 'artifact-baseline.json'), JSON.stringify({ runId,
    baseURL: 'https://localhost:9999', langKeys: ['existing_key'], totalLangKeyCount: 1 }));
  keys = [];
  let uid = 1;
  for (let index = 0; index < 9; index++) {
    const dataset = `e2e_native_dataset_${index}_mvan123`;
    const own = (name: string, columns: string[]) => {
      registerTestArtifact('dataset', name);
      confirmTestArtifact('dataset', name, uid++, columns);
      unregisterTestArtifact('dataset', name);
      keys.push(name, `${name}_front_page`, `add_row_${name}`, `search_for_${name}`, `search_slogan_${name}`);
    };
    own(dataset, ['id', 'title']);
    if (index < 3) {
      own(`${dataset}_assets`, ['id', `${dataset}_id`]);
      keys.push(`${dataset}_id`, `${dataset}_id_asc`, `${dataset}_id_desc`, `search_for_${dataset}_id`);
    }
  }
  api.cleanupSyntheticTestArtifactsWithStorageState.mockResolvedValue({ deletedDatasets: [], deletedFolders: [],
    remainingDatasetNames: [], remainingFolderNames: [] });
  api.readLangKeyInventoryWithStorageState.mockImplementation(async () => ({
    allLangKeys: ['existing_key', ...keys], totalLangKeyCount: keys.length + 1,
  }));
  source.readLangKeySourcesWithStorageState.mockImplementation(async (_url, _state, candidates) =>
    new Map(candidates.map((key: string) => [key, []])));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterAll(() => {
  fs.rmSync(runtime.root, { recursive: true, force: true });
  if (runtime.previous === undefined) delete process.env.FILTEREST_TEST_RUNTIME_ROOT;
  else process.env.FILTEREST_TEST_RUNTIME_ROOT = runtime.previous;
});

test('all 72 native additions retain exact column/dataset and dropped-source explanations', async () => {
  expect(keys).toHaveLength(72);
  await expect(globalTeardown(config)).resolves.toBeUndefined();
  const result = JSON.parse(fs.readFileSync(report, 'utf8'));
  expect(result).toMatchObject({ status: 'complete', retainedOwnRunLangKeyCount: 72,
    retainedOwnRunLangKeys: keys, unexplainedAddedLangKeys: [], removedLangKeys: [] });
  expect(result.retainedOwnRunLangKeyEvidence).toHaveLength(72);
  expect(result.retainedOwnRunLangKeyEvidence.find(entry => entry.key === 'e2e_native_dataset_0_mvan123_id_asc'))
    .toEqual({ key: 'e2e_native_dataset_0_mvan123_id_asc', dataset: 'e2e_native_dataset_0_mvan123_assets',
      column: 'e2e_native_dataset_0_mvan123_id', ownership: 'completed-dataset-history',
      countingSources: 'complete-empty-inventory-after-drop' });
});

test.each(['e2e_other_run_123', 'e2e_native_dataset_0_mvan123_different_suffix',
  'e2e_native_dataset_0_mvan123_missing_column_asc'])(
  'negative control: additional foreign dataset, lookalike or unknown column fails: %s', async key => {
    keys.push(key);
    await expect(globalTeardown(config)).rejects.toThrow(`added=${key}; removed=none`);
    expect(JSON.parse(fs.readFileSync(report, 'utf8'))).toMatchObject({
      status: 'incomplete: language-key drift comparison failed', retainedOwnRunLangKeyCount: 0,
      retainedOwnRunLangKeyEvidence: [], unexplainedAddedLangKeys: [key],
    });
  },
);

test('a removed baseline key fails with zero accepted even alongside all own additions', async () => {
  api.readLangKeyInventoryWithStorageState.mockResolvedValue({ allLangKeys: keys, totalLangKeyCount: keys.length });
  await expect(globalTeardown(config)).rejects.toThrow('added=none; removed=existing_key');
  expect(JSON.parse(fs.readFileSync(report, 'utf8'))).toMatchObject({
    retainedOwnRunLangKeyCount: 0, retainedOwnRunLangKeyEvidence: [], removedLangKeys: ['existing_key'],
  });
});

test('unavailable source inventory fails and includes all 72 unverified candidates', async () => {
  const failure = new Error('source unavailable');
  source.readLangKeySourcesWithStorageState.mockRejectedValue(failure);
  await expect(globalTeardown(config)).rejects.toBe(failure);
  expect(JSON.parse(fs.readFileSync(report, 'utf8'))).toMatchObject({
    status: 'incomplete: language-key source read failed', retainedOwnRunLangKeyCount: 0,
    retainedOwnRunLangKeyEvidence: [], unverifiedOwnRunLangKeys: keys,
  });
});
