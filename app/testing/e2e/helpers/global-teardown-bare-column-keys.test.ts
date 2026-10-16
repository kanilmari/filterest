/**
 * global-teardown-bare-column-keys.test.ts
 * Replays C13's four bare FK labels using real column recording and teardown.
 * Connects pre-drop fake administrator reads to disposable run history and reports.
 * Proves missing, foreign, unrelated and removed evidence cannot pass silently.
 */
// @vitest-environment node
import type { APIRequestContext, FullConfig } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterAll, beforeEach, expect, test, vi } from 'vitest';
import type { LangKeySource } from './lang-key-drift-attribution';

const runtime = vi.hoisted(() => {
  const previous = process.env.FILTEREST_TEST_RUNTIME_ROOT;
  const root = `/tmp/filterest-bare-column-keys-${process.pid}`;
  process.env.FILTEREST_TEST_RUNTIME_ROOT = root;
  return { root, previous };
});
const api = vi.hoisted(() => ({ cleanupSyntheticTestArtifactsWithStorageState: vi.fn(),
  readLangKeyInventoryWithStorageState: vi.fn(), normalizeE2EBaseURL: (value: string) => value,
  validateSyntheticArtifactBaseline: (value: unknown) => value }));
const source = vi.hoisted(() => ({ readLangKeySourcesWithStorageState: vi.fn() }));
vi.mock('./test-artifact-cleanup', () => api);
vi.mock('./lang-key-source-inventory', async importOriginal => ({
  ...await importOriginal<typeof import('./lang-key-source-inventory')>(), ...source,
}));
import globalTeardown from '../global-teardown';
import { confirmTestArtifact, initializeArtifactRunRegistry, registerTestArtifact,
  unregisterTestArtifact } from './test-artifact-run-registry';
import { recordTestDatasetColumnsFromRequest } from './test-artifact-dataset-column-recorder';

const runId = 'run-c13-bare-column-keys';
const parent = 'e2e_appearance_parent_run207';
const children = ['e2e_appearance_child_a_run207', 'e2e_appearance_child_b_run207'];
const names = [parent, ...children];
const nativeKeys = ['parent_ref', 'parent_ref_asc', 'parent_ref_desc', 'search_for_parent_ref'];
const auth = path.join(runtime.root, 'e2e', '.auth');
const report = path.join(runtime.root, 'e2e', 'lang-key-retention', `${runId}.json`);
const config = { projects: [{ use: { baseURL: 'https://localhost:9999' } }] } as unknown as FullConfig;
const columnSource = (dataset: string, column = 'parent_ref'): LangKeySource =>
  ({ source_type: 'column', source_high: dataset, source_low: column });
const bookkeeping: LangKeySource[] = [
  { source_type: 'foreign_key', source_high: 'public.system_lang_key_translations.lang_key_id', source_low: 'lang_key_id' },
  { source_type: 'orphan', source_high: 'consistency_scan', source_low: '' },
  { source_type: 'manual_crud', source_high: 'admin_ui', source_low: '' },
];
let keys: string[];
let baseline: string[];
let beforeDrop: LangKeySource[];
let omitKey: boolean;
let sourceFailure: boolean;

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  fs.rmSync(runtime.root, { recursive: true, force: true });
  initializeArtifactRunRegistry({ rootDirectory: path.join(auth, 'artifact-runs'), runId });
  keys = [...nativeKeys];
  baseline = ['existing_key', 'id', 'name', 'title', 'id_asc', 'id_desc', 'search_for_id',
    'name_asc', 'name_desc', 'search_for_name', 'title_asc', 'title_desc', 'search_for_title'];
  beforeDrop = [...children.map(name => columnSource(name)), ...bookkeeping];
  omitKey = false;
  sourceFailure = false;
  fs.writeFileSync(path.join(auth, 'user.json'), '{}');
  api.cleanupSyntheticTestArtifactsWithStorageState.mockResolvedValue({ deletedDatasets: [], deletedFolders: [],
    remainingDatasetNames: [], remainingFolderNames: [] });
  api.readLangKeyInventoryWithStorageState.mockImplementation(async () => ({
    allLangKeys: [...baseline, ...keys.filter(key => !baseline.includes(key))],
    totalLangKeyCount: new Set([...baseline, ...keys]).size,
  }));
  source.readLangKeySourcesWithStorageState.mockImplementation(async (_url, _state, candidates: string[]) =>
    new Map(candidates.map(key => [key, []])));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterAll(() => {
  fs.rmSync(runtime.root, { recursive: true, force: true });
  if (runtime.previous === undefined) delete process.env.FILTEREST_TEST_RUNTIME_ROOT;
  else process.env.FILTEREST_TEST_RUNTIME_ROOT = runtime.previous;
});

/** Runs the existing pre-drop metadata recorder while the C13 children still exist. */
async function recordAndDrop(readEvidence = true, afterFirstChildDrop?: () => void) {
  fs.writeFileSync(path.join(auth, 'artifact-baseline.json'), JSON.stringify({ runId,
    baseURL: 'https://localhost:9999', langKeys: baseline, totalLangKeyCount: baseline.length }));
  for (const [index, name] of names.entries()) {
    registerTestArtifact('dataset', name);
    const columns = index === 0 ? ['id', 'title'] : ['id', 'name', 'parent_ref'];
    confirmTestArtifact('dataset', name, index + 1, columns);
    const request = { get: async (url: string, options?: { params: Record<string, unknown> }) => {
      let payload: unknown;
      if (url.startsWith('/api/card-visibility/')) payload = { table_name: name,
        dataset_appearance: { dataset_uid: index + 1 }, columns: columns.map(column_name => ({ column_name })) };
      else if (url === '/api/admin/version-info') payload = {};
      else if (url === '/api/get-results') {
        if (sourceFailure) throw new Error('private transport detail');
        const params = options!.params;
        if (params.dataset === 'system_lang_keys') payload = { row_count: omitKey ? 0 : 1,
          data: omitKey ? [] : [{ id: 10, lang_key: params.lang_key_from }] };
        else payload = { row_count: beforeDrop.length,
          data: beforeDrop.map((item, i) => ({ id: i + 1, lang_key_id: 10, ...item })) };
      } else throw new Error('Unexpected fake GET');
      return { ok: () => true, status: () => 200, json: async () => payload };
    } } as unknown as APIRequestContext;
    if (readEvidence) await recordTestDatasetColumnsFromRequest(request, name);
    unregisterTestArtifact('dataset', name);
    if (index === 1) afterFirstChildDrop?.();
  }
}

test('C13 replay: all four bare keys shared by two owned children pass after drops', async () => {
  await recordAndDrop();
  await expect(globalTeardown(config)).resolves.toBeUndefined();
  const result = JSON.parse(fs.readFileSync(report, 'utf8'));
  expect(result).toMatchObject({ status: 'complete', retainedOwnRunLangKeyCount: 4,
    retainedOwnRunLangKeys: nativeKeys, unexplainedAddedLangKeys: [], removedLangKeys: [] });
  expect(result.retainedOwnRunLangKeyEvidence).toHaveLength(4);
  for (const item of result.retainedOwnRunLangKeyEvidence) {
    expect(item).toMatchObject({ datasets: children, column: 'parent_ref',
      countingSources: 'verified-pre-drop-column-sources' });
  }
});

test.each([
  ['foreign dataset', columnSource('app_foreign_dataset')],
  ['lookalike dataset', columnSource(`${children[0]}_other`)],
  ['wrong column', columnSource(children[0], 'missing_column')],
  ['non-column counting source', { source_type: 'table', source_high: children[0], source_low: 'parent_ref' }],
  ['unknown counting source', { source_type: 'future_source', source_high: children[0], source_low: 'parent_ref' }],
])('negative control: pre-drop %s evidence fails even after sources disappear', async (_reason, badSource) => {
  beforeDrop.push(badSource);
  await recordAndDrop();
  await expect(globalTeardown(config)).rejects.toThrow(`added=${nativeKeys.join(', ')}`);
  expect(JSON.parse(fs.readFileSync(report, 'utf8'))).toMatchObject({ retainedOwnRunLangKeyCount: 0,
    unexplainedAddedLangKeys: nativeKeys, retainedOwnRunLangKeyEvidence: [] });
});

test.each(['missing_column', 'missing_column_asc', 'parent_ref_ascending', 'xparent_ref', 'search_for_parent_ref_other'])(
  'negative control: unrecorded column or lookalike fails: %s', async key => {
    keys.push(key);
    await recordAndDrop();
    await expect(globalTeardown(config)).rejects.toThrow(`added=${key}; removed=none`);
  },
);

test.each(['no snapshot', 'absent key', 'empty inventory', 'bookkeeping only'])(
  'negative control: missing counting evidence fails: %s', async reason => {
    omitKey = reason === 'absent key';
    if (reason === 'empty inventory') beforeDrop = [];
    if (reason === 'bookkeeping only') beforeDrop = bookkeeping;
    await recordAndDrop(reason !== 'no snapshot');
    await expect(globalTeardown(config)).rejects.toThrow(`added=${nativeKeys.join(', ')}`);
  },
);

test('negative control: a removed baseline bare key still fails', async () => {
  baseline.push(nativeKeys[0]);
  keys = nativeKeys.slice(1);
  await recordAndDrop();
  api.readLangKeyInventoryWithStorageState.mockResolvedValue({
    allLangKeys: [...baseline.filter(key => key !== nativeKeys[0]), ...keys],
    totalLangKeyCount: baseline.length - 1 + keys.length,
  });
  await expect(globalTeardown(config)).rejects.toThrow('added=none; removed=parent_ref');
});

test('a shared name present at baseline contributes no added key or accepted count', async () => {
  baseline.push(...nativeKeys);
  await recordAndDrop();
  await expect(globalTeardown(config)).resolves.toBeUndefined();
  expect(JSON.parse(fs.readFileSync(report, 'utf8'))).toMatchObject({ retainedOwnRunLangKeyCount: 0,
    retainedOwnRunLangKeys: [], unexplainedAddedLangKeys: [] });
});

test('pre-drop transport failure propagates without leaking response details', async () => {
  sourceFailure = true;
  await expect(recordAndDrop()).rejects.toThrow(/language-key attribution/);
});

test('an earlier foreign source survives later clean snapshots and still fails', async () => {
  beforeDrop.push(columnSource('app_foreign_dataset'));
  await recordAndDrop(true, () => { beforeDrop = [...children.map(name => columnSource(name)), ...bookkeeping]; });
  await expect(globalTeardown(config)).rejects.toThrow(`added=${nativeKeys.join(', ')}`);
});

test('a foreign source appearing after drops still fails with valid pre-drop evidence', async () => {
  await recordAndDrop();
  source.readLangKeySourcesWithStorageState.mockImplementation(async (_url, _state, candidates: string[]) =>
    new Map(candidates.map(key => [key, [columnSource('app_foreign_dataset')]])));
  await expect(globalTeardown(config)).rejects.toThrow(`added=${nativeKeys.join(', ')}`);
});

test('corrupt persisted snapshots fail visibly and keep the run evidence', async () => {
  await recordAndDrop();
  const directory = path.join(auth, 'artifact-runs', runId, 'dataset-column-key-sources');
  fs.writeFileSync(path.join(directory, fs.readdirSync(directory)[0]), '{');
  await expect(globalTeardown(config)).rejects.toThrow(/Invalid E2E pre-drop/);
  expect(JSON.parse(fs.readFileSync(report, 'utf8'))).toMatchObject({
    status: 'incomplete: pre-drop column-key source history read failed', retainedOwnRunLangKeyCount: 0,
  });
  expect(fs.existsSync(directory)).toBe(true);
});
