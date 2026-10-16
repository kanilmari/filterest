/**
 * test-artifact-asset-children.test.ts
 * Replays the 36 native H6/T9 additions through real pre-drop ownership recording.
 * Connects authenticated relation/column fixtures to immutable registry history.
 * Proves missing, foreign or malformed evidence cannot authorize retained keys.
 */
// @vitest-environment node
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Page } from '@playwright/test';
import { confirmTestArtifact, initializeArtifactRunRegistry, listRegisteredTestArtifacts,
  registerTestArtifact } from './test-artifact-run-registry';
import { readCompletedDatasetNames } from './test-artifact-dataset-history';
import { readRecordedDatasetColumns } from './test-artifact-dataset-columns';
import { recordTestDatasetOwnershipFromRequest } from './test-artifact-dataset-column-recorder';
import { attributeLangKeyDrift, type LangKeySource } from './lang-key-drift-attribution';
import { attributeRecordedLangKeyDrift, generatedColumnKeys } from './bare-column-key-attribution';
import { readRecordedColumnKeySources } from './test-artifact-column-key-sources';
import { cleanupDatasetViaRequest, dropTempDataset } from './temp-dataset';
import { fakeApi, response } from './test-artifact-recovery-fakes';

// Exact parent names from run-baf2010f-43a1-4338-b9cf-9c4fb854216f.json.
const parents = ['e2e_file_upload_mvaqzoh8_4azuu9', 'e2e_file_upload_mvar1j5a_408sih',
  'e2e_folder_table_mvar0iu8_74vsc9', 'e2e_folder_table_mvar2jjd_nbh0fl'];
const parent = parents[0];
const child = `${parent}_assets`;
const childKeys = (name: string) => [`${name}_assets`, `${name}_assets_front_page`,
  `add_row_${name}_assets`, `search_for_${name}_assets`, `search_slogan_${name}_assets`,
  `${name}_id`, `${name}_id_asc`, `${name}_id_desc`, `search_for_${name}_id`];
const nativeKeys = parents.flatMap(childKeys).sort();
const runId = 'run-asset-child-proof';
let root: string;
let directory: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'filterest-asset-child-'));
  const registryRoot = path.join(root, 'artifact-runs');
  directory = path.join(registryRoot, runId);
  initializeArtifactRunRegistry({ rootDirectory: registryRoot, runId });
  for (const [index, name] of parents.entries()) {
    registerTestArtifact('dataset', name);
    confirmTestArtifact('dataset', name, 100 + index, ['id']);
  }
});
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const datasets = Object.fromEntries(parents.flatMap((name, index) => [
    [name, { uid: 100 + index }], [`${name}_assets`, { uid: 200 + index }],
  ]));
  const api = fakeApi(datasets);
  const originalGet = api.get.getMockImplementation()!;
  const relation = (name: string) => ({ parent_table: name, child_table: `${name}_assets`,
    foreign_key_column: `${name}_id`, relation_id: 300 + parents.indexOf(name) });
  const state = {
    dropStatus: 200,
    status: (name: string): unknown => ({ image_asset_linkings: [relation(name)],
      attachment_asset_linkings: [relation(name)] }),
    metadata: (name: string): unknown => ({ table_name: name,
      dataset_appearance: { dataset_uid: datasets[name]?.uid },
      columns: ['id', ...(name.endsWith('_assets') ? [name.replace(/_assets$/, '_id')] : [])]
        .map(column_name => ({ column_name })) }),
  };
  api.get.mockImplementation(async (url, options) => {
    if (url.startsWith('/api/asset-linking/status?table=')) {
      return response(state.status(decodeURIComponent(url.split('=')[1])));
    }
    if (url.startsWith('/api/card-visibility/')) {
      return response(state.metadata(decodeURIComponent(url.slice('/api/card-visibility/'.length))));
    }
    return originalGet(url, options);
  });
  const drops: string[] = [];
  const page = { request: api.request, evaluate: async (callback: () => unknown,
    argument?: { url?: string; payload?: { dataset_name: string } }) => {
    if (callback.toString().includes('/api/tree_data')) {
      return { status: 200, ok: true, body: await (await api.get('/api/tree_data')).text() };
    }
    if (!argument) return { status: 200, ok: true, body: JSON.stringify({ csrf_token: 'fake-csrf' }) };
    expect(argument.url).toBe('/api/drop-dataset');
    const name = argument.payload!.dataset_name;
    drops.push(name);
    if (state.dropStatus !== 200) return { status: state.dropStatus, ok: false, body: 'drop failed' };
    delete datasets[name];
    delete datasets[`${name}_assets`];
    return { status: 200, ok: true, body: 'dropped' };
  } } as unknown as Page;
  return { api, state, relation, page, drops };
}

function replay(keys = nativeKeys, removed: string[] = []) {
  const completedDatasetNames = new Set(readCompletedDatasetNames(directory, runId));
  const names = [...new Set([...completedDatasetNames,
    ...listRegisteredTestArtifacts().map(artifact => artifact.name)])];
  const columnsByDataset = readRecordedDatasetColumns(directory, runId, names);
  return attributeLangKeyDrift(keys, removed, names, new Map(keys.map(key => [key, []])),
    { columnsByDataset, completedDatasetNames });
}

/** Adds real pre-drop source reads with a baseline isolated inside the temporary registry. */
function fixtureWithBareColumnSources() {
  const result = fixture();
  const { api, state, relation } = result;
  const sources: LangKeySource[] = [parent, child].map(source_high => ({
    source_type: 'column', source_high, source_low: 'parent_ref',
  }));
  const evidence = { parentReads: 0, childReads: 0, sources: () => sources };
  const metadata = state.metadata;
  state.metadata = name => ({ ...metadata(name) as object,
    columns: ['id', 'parent_ref'].map(column_name => ({ column_name })) });
  state.status = name => ({ image_asset_linkings: [{ ...relation(name), foreign_key_column: 'parent_ref' }],
    attachment_asset_linkings: [] });
  fs.writeFileSync(path.join(root, 'artifact-baseline.json'), JSON.stringify({
    runId, langKeys: generatedColumnKeys('id'),
  }));
  const get = api.get.getMockImplementation()!;
  api.get.mockImplementation(async (url, options) => {
    if (url === `/api/card-visibility/${parent}`) evidence.parentReads++;
    if (url === `/api/card-visibility/${child}`) evidence.childReads++;
    if (url === '/api/get-results') {
      const params = options?.params as Record<string, unknown>;
      if (params.dataset === 'system_lang_keys') return response({ row_count: 1,
        data: [{ id: 10, lang_key: params.lang_key_from }] });
      expect(params.dataset).toBe('system_lang_key_sources');
      const rows = evidence.sources().map((source, index) => ({ id: index + 1, lang_key_id: 10, ...source }));
      return response({ row_count: rows.length, data: rows });
    }
    return get(url, options);
  });
  return { ...result, evidence, sources };
}

function replayBareColumnKeys() {
  const keys = generatedColumnKeys('parent_ref');
  const completedDatasetNames = new Set(readCompletedDatasetNames(directory, runId));
  const names = [...new Set([...completedDatasetNames,
    ...listRegisteredTestArtifacts().map(artifact => artifact.name)])];
  const columnsByDataset = readRecordedDatasetColumns(directory, runId, names);
  return attributeRecordedLangKeyDrift(keys, [], names, new Map(keys.map(key => [key, []])),
    { columnsByDataset, completedDatasetNames },
    readRecordedColumnKeySources(directory, runId, names, columnsByDataset));
}

test('asset bare-key sources survive parent drops and repeated parent captures are idempotent', async () => {
  const { api, page, evidence } = fixtureWithBareColumnSources();
  await recordTestDatasetOwnershipFromRequest(api.request, parent);
  expect(evidence).toMatchObject({ parentReads: 2, childReads: 2 });
  const snapshots = path.join(directory, 'dataset-column-key-sources');
  const original = fs.readdirSync(snapshots).sort();
  expect(original).toHaveLength(8); // Four exact shapes for both confirmed datasets.
  await recordTestDatasetOwnershipFromRequest(api.request, parent);
  expect(fs.readdirSync(snapshots).sort()).toEqual(original);
  await dropTempDataset(page, parent);
  await cleanupDatasetViaRequest(api.request, child);
  expect(replayBareColumnKeys()).toEqual({
    retainedOwnRun: generatedColumnKeys('parent_ref'), unexplainedAdded: [], removed: [],
  });
  expect(api.post).not.toHaveBeenCalled();
});

test('the second parent capture preserves an earlier foreign source after later clean reads', async () => {
  const { api, page, evidence, sources } = fixtureWithBareColumnSources();
  evidence.sources = () => evidence.parentReads === 1
    ? [...sources, { source_type: 'column', source_high: 'app_foreign_dataset', source_low: 'parent_ref' }]
    : sources;
  await dropTempDataset(page, parent);
  await cleanupDatasetViaRequest(api.request, child);
  expect(replayBareColumnKeys()).toEqual({
    retainedOwnRun: [], unexplainedAdded: generatedColumnKeys('parent_ref'), removed: [],
  });
});

test('an asset-child source failure propagates before any parent drop', async () => {
  const { api, page, drops, evidence, sources } = fixtureWithBareColumnSources();
  evidence.sources = () => {
    if (evidence.childReads >= 2) throw new Error('private source response');
    return sources;
  };
  await expect(dropTempDataset(page, parent)).rejects.toThrow(/language-key attribution/);
  expect(drops).toEqual([]);
  expect(api.post).not.toHaveBeenCalled();
  expect(listRegisteredTestArtifacts()).toContainEqual(expect.objectContaining({
    name: child, status: 'confirmed', serverId: 200,
  }));
});

test('pre-drop relation proof records all four server children and accepts the exact 36 native keys', async () => {
  const { api, page } = fixture();
  for (const name of parents) await dropTempDataset(page, name);
  const children = listRegisteredTestArtifacts();
  // Teardown sees only registered artifacts. Parent removal already dropped
  // its children; prove absence without another mutating request.
  for (const artifact of children) await cleanupDatasetViaRequest(api.request, artifact.name);
  expect(nativeKeys).toHaveLength(36);
  expect(replay()).toEqual({ retainedOwnRun: nativeKeys, unexplainedAdded: [], removed: [] });
  for (const [index, name] of parents.entries()) {
    expect(children).toContainEqual(expect.objectContaining({
      name: `${name}_assets`, status: 'confirmed', serverId: 200 + index,
    }));
  }
  expect(replay(nativeKeys, [parent]).removed).toEqual([parent]);
  expect(listRegisteredTestArtifacts()).toEqual([]);
  expect(api.post).not.toHaveBeenCalled();
  expect(readRecordedDatasetColumns(directory, runId, readCompletedDatasetNames(directory, runId))
    .get(child)?.sort()).toEqual([`${parent}_id`, 'id']);
});

test.each(['image_asset_linkings', 'attachment_asset_linkings'])(
  'either existing asset profile proves ownership: %s', async profile => {
    const { api, page, state, relation } = fixture();
    state.status = name => ({ image_asset_linkings: [], attachment_asset_linkings: [], [profile]: [relation(name)] });
    await dropTempDataset(page, parent);
    await cleanupDatasetViaRequest(api.request, child);
    expect(replay(childKeys(parent)).unexplainedAdded).toEqual([]);
  },
);

test('an existing child name without a recorded relation explains none of its nine keys', async () => {
  const { page, state } = fixture();
  state.status = () => ({ image_asset_linkings: [], attachment_asset_linkings: [] });
  await dropTempDataset(page, parent);
  expect(replay(childKeys(parent))).toEqual({
    retainedOwnRun: [], unexplainedAdded: childKeys(parent), removed: [],
  });
  expect(listRegisteredTestArtifacts().some(artifact => artifact.name === child)).toBe(false);
});

test('an unowned parent cannot trigger metadata reads or adopt a child', async () => {
  const { api, page } = fixture();
  await expect(dropTempDataset(page, 'e2e_someone_else')).rejects.toThrow(/unregistered/);
  expect(api.get).not.toHaveBeenCalled();
  expect(replay(childKeys('e2e_someone_else')).unexplainedAdded).toEqual(childKeys('e2e_someone_else'));
});

test.each([
  { parent_table: 'e2e_someone_else' },
  { child_table: `${child}_lookalike` },
  { relation_id: 0 },
  { foreign_key_column: 'unrecorded_column' },
])('invalid relation cannot adopt a child or permit a drop: %j', async override => {
  const { page, state, relation, drops } = fixture();
  state.status = name => ({ image_asset_linkings: [{ ...relation(name), ...override }], attachment_asset_linkings: [] });
  await expect(dropTempDataset(page, parent)).rejects.toThrow(/Invalid/);
  expect(drops).toEqual([]);
  expect(replay(childKeys(parent)).unexplainedAdded).toEqual(childKeys(parent));
});

test('lookalike suffixes still fail with correctly recorded asset ownership', async () => {
  const { api, page } = fixture();
  await dropTempDataset(page, parent);
  await cleanupDatasetViaRequest(api.request, child);
  const keys = [`${child}_other`, `add_row_${child}_other`, `${parent}_id_asc_other`];
  expect(replay(keys).unexplainedAdded).toEqual(keys);
});

test.each(['transport', 'http', 'json', 'shape'])(
  'asset metadata failure propagates without authorizing child keys: %s', async failure => {
    const { api, page, state, drops } = fixture();
    const get = api.get.getMockImplementation()!;
    api.get.mockImplementation(async (url, options) => {
      if (!url.startsWith('/api/asset-linking/status')) return get(url, options);
      if (failure === 'transport') throw new Error('private transport content');
      if (failure === 'http') return response({ private: 'response' }, 403);
      if (failure === 'json') return { ...response({}), json: async () => { throw new Error('private JSON'); } };
      return response({ image_asset_linkings: null, attachment_asset_linkings: [] });
    });
    state.status = () => ({});
    await expect(dropTempDataset(page, parent)).rejects.toThrow(/ownership|asset-linking/);
    expect(drops).toEqual([]);
    expect(replay(childKeys(parent)).unexplainedAdded).toEqual(childKeys(parent));
  },
);

test.each([
  { table_name: 'e2e_other_assets' }, { dataset_appearance: { dataset_uid: 0 } },
  { dataset_appearance: { dataset_uid: 100 } }, { columns: [{ column_name: 'id' }] },
])('invalid child identity or columns fail closed: %j', async override => {
  const { page, state, drops } = fixture();
  const metadata = state.metadata;
  state.metadata = name => name === child ? { ...metadata(name) as object, ...override } : metadata(name);
  await expect(dropTempDataset(page, parent)).rejects.toThrow(/Invalid/);
  expect(drops).toEqual([]);
  expect(replay(childKeys(parent)).unexplainedAdded).toEqual(childKeys(parent));
});

test('conflicting profile relation identities cannot confirm child ownership', async () => {
  const { page, state, relation, drops } = fixture();
  state.status = name => ({ image_asset_linkings: [relation(name)],
    attachment_asset_linkings: [{ ...relation(name), relation_id: 999 }] });
  await expect(dropTempDataset(page, parent)).rejects.toThrow(/Invalid/);
  expect(drops).toEqual([]);
  expect(replay(childKeys(parent)).unexplainedAdded).toEqual(childKeys(parent));
});

test('a parent replaced during relation reads cannot authorize a child', async () => {
  const { page, state, drops } = fixture();
  const metadata = state.metadata;
  let parentReads = 0;
  state.metadata = name => name === parent && ++parentReads > 1
    ? { ...metadata(name) as object, dataset_appearance: { dataset_uid: 999 } } : metadata(name);
  await expect(dropTempDataset(page, parent)).rejects.toThrow(/Invalid/);
  expect(drops).toEqual([]);
  expect(replay(childKeys(parent)).unexplainedAdded).toEqual(childKeys(parent));
});

test('a failed parent drop keeps confirmed child evidence and a retry preserves immutable records', async () => {
  const { api, page, state } = fixture();
  state.dropStatus = 500;
  await expect(dropTempDataset(page, parent)).rejects.toThrow();
  const artifact = listRegisteredTestArtifacts().find(entry => entry.name === child);
  expect(artifact).toMatchObject({ status: 'confirmed', serverId: 200 });
  const columns = path.join(directory, 'dataset-columns');
  const records = fs.readdirSync(columns).map(name => fs.readFileSync(path.join(columns, name), 'utf8')).sort();
  state.dropStatus = 200;
  await dropTempDataset(page, parent);
  expect(listRegisteredTestArtifacts().find(entry => entry.name === child)).toEqual(artifact);
  expect(fs.readdirSync(columns).map(name => fs.readFileSync(path.join(columns, name), 'utf8')).sort()).toEqual(records);
  await cleanupDatasetViaRequest(api.request, child);
  expect(replay(childKeys(parent)).unexplainedAdded).toEqual([]);
});

test('T9 request-scoped cleanup captures the child before the parent drop removes metadata', async () => {
  const name = parents[2];
  const { api } = fixture();
  api.post.mockImplementationOnce(async (url, options) => {
    expect(url).toBe('/api/drop-dataset');
    expect(options.data.dataset_name).toBe(name);
    expect(listRegisteredTestArtifacts()).toContainEqual(expect.objectContaining({
      name: `${name}_assets`, status: 'confirmed', serverId: 202,
    }));
    delete api.datasets[name];
    delete api.datasets[`${name}_assets`];
    return response({ message: 'dropped' });
  });
  // Mirror T9's request-only cleanup; no browser is launched.
  await recordTestDatasetOwnershipFromRequest(api.request, name);
  await cleanupDatasetViaRequest(api.request, name);
  await cleanupDatasetViaRequest(api.request, `${name}_assets`);
  expect(api.post).toHaveBeenCalledOnce();
  expect(replay(childKeys(name)).unexplainedAdded).toEqual([]);
});

test.each(['page', 'request'] as const)('shared %s drop registers its managed asset child before metadata disappears', async mode => {
  const { api, page, drops } = fixture();
  const assertChild = () => expect(listRegisteredTestArtifacts()).toContainEqual(expect.objectContaining({
    name: child, status: 'confirmed', serverId: 200,
  }));
  if (mode === 'request') {
    api.post.mockImplementation(async (_url, options) => {
      assertChild();
      drops.push(options.data.dataset_name);
      delete api.datasets[parent]; delete api.datasets[child];
      return response({ message: 'dropped' });
    });
    await cleanupDatasetViaRequest(api.request, parent);
  } else await dropTempDataset(page, parent);
  assertChild();
  expect(drops).toEqual([parent]);
  expect(readRecordedDatasetColumns(directory, runId, [...parents, child]).get(child)).toEqual(expect.arrayContaining(['id', `${parent}_id`]));
});

test('shared request drop propagates ownership failure and never attempts deletion', async () => {
  const { api, state } = fixture();
  state.status = () => ({ image_asset_linkings: 'invalid', attachment_asset_linkings: [] });
  await expect(cleanupDatasetViaRequest(api.request, parent)).rejects.toThrow(/ownership evidence/);
  expect(api.post).not.toHaveBeenCalled();
});
