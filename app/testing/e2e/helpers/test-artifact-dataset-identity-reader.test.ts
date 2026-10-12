/**
 * test-artifact-dataset-identity-reader.test.ts
 * Verifies exact dataset identity and inventory-based absence using fake APIs.
 * Bridges named metadata and the registry's existing authenticated inventories.
 * Keeps absent, ambiguous and mismatched names from authorizing recovery drops.
 */
// @vitest-environment node
import type { APIRequestContext } from '@playwright/test';
import { expect, test, vi } from 'vitest';
import { readDatasetIdentityFromRequest } from './test-artifact-dataset-identity-reader';
import { datasetTreeNode, serverTreeResponse, treeResponseWithDatasetNodes } from './test-artifact-tree-fixture';

function fakeRequest(data: unknown, nodes: unknown = [datasetTreeNode('e2e_exact', '919')],
  datasets: unknown = [{ dataset_name: 'e2e_exact', table_uid: 919 }], metadataStatus = 200, inventoryStatus = 200) {
  const get = vi.fn(async (url: string) => {
    const payload = url === '/api/get-metadata' ? { data }
      : url === '/api/tree_data' ? Array.isArray(nodes) ? treeResponseWithDatasetNodes(nodes) : { nodes } : { datasets };
    const status = url === '/api/get-metadata' ? metadataStatus : inventoryStatus;
    return { ok: () => status === 200, status: () => status, json: async () => payload,
      text: async () => JSON.stringify(payload) };
  });
  return { request: { get } as unknown as APIRequestContext, get };
}
const exact = { table_name: 'e2e_exact', table_uid: 919, schema_name: 'public', created: '2026-10-11T12:00:01Z' };

test('reads exact metadata name and stable UID with an encoded dataset parameter', async () => {
  const { request, get } = fakeRequest([exact]);
  await expect(readDatasetIdentityFromRequest(request, 'e2e_exact')).resolves.toEqual({
    tableUID: 919,
  });
  expect(get).toHaveBeenCalledWith('/api/get-metadata', { params: { dataset: 'e2e_exact' } });
});

test('proves absence through both inventories when deleted metadata would return 403', async () => {
  const { request, get } = fakeRequest([], [], [], 403);
  await expect(readDatasetIdentityFromRequest(request, 'e2e_exact')).resolves.toBeNull();
  expect(get.mock.calls.map(([url]) => url)).toEqual(['/api/tree_data', '/api/datasets']);
});

test.each([
  ['both inventories', [datasetTreeNode('e2e_renamed', '919')], [{ dataset_name: 'e2e_renamed', table_uid: 919 }]],
  ['tree alone', [datasetTreeNode('e2e_renamed', 919)], []],
  ['catalogue alone', [], [{ dataset_name: 'e2e_renamed', table_uid: '919' }]],
])('Views root and unregistered views: confirmed absence refuses surviving server id in %s', async (_reason, nodes, datasets) => {
  const { request, get } = fakeRequest([], nodes, datasets, 403);
  await expect(readDatasetIdentityFromRequest(request, 'e2e_exact', 919))
    .rejects.toThrow(/recorded dataset "e2e_exact" serverId=919.*dataset "e2e_renamed" serverId=919/);
  expect(get.mock.calls.map(([url]) => url)).not.toContain('/api/get-metadata');
});

test.each([
  [[datasetTreeNode('unrelated', undefined)], []],
  [[datasetTreeNode('unrelated', 'invalid')], []],
  [[], [{ dataset_name: 'unrelated' }]],
  [[], [{ dataset_name: 'unrelated', table_uid: 0 }]],
])('Views root and unregistered views: confirmed absence refuses inventories with unprovable ids: %j/%j', async (nodes, datasets) => {
  const { request } = fakeRequest([], nodes, datasets, 403);
  await expect(readDatasetIdentityFromRequest(request, 'e2e_exact', 919)).rejects.toThrow(/stable table_uid required/);
});

test('confirmed absence ignores folder ids while scanning every dataset identity', async () => {
  const { request } = fakeRequest([], [{ id: 'f_919', name: 'folder', db_id: 919 },
    datasetTreeNode('unrelated', '920')], [{ dataset_name: 'unrelated', table_uid: 920 }], 403);
  await expect(readDatasetIdentityFromRequest(request, 'e2e_exact', 919)).resolves.toBeNull();
});

test('confirmed identity refuses a catalogue id that disagrees with the exact tree and metadata', async () => {
  const { request } = fakeRequest([exact], undefined, [{ dataset_name: 'e2e_exact', table_uid: 920 }]);
  await expect(readDatasetIdentityFromRequest(request, 'e2e_exact', 919))
    .rejects.toThrow(/server-id mismatch: recorded=919, current=920/);
});

test.each([
  ['wrong name', [{ ...exact, table_name: 'e2e_other' }]],
  ['wrong id', [{ ...exact, table_uid: 920 }]],
  ['non-public schema', [{ ...exact, schema_name: 'other' }]],
  ['missing id', [{ ...exact, table_uid: undefined }]],
  ['duplicate name', [exact, exact]],
  ['absent metadata with present tree', []],
  ['malformed data', {}],
])('refuses inconsistent named dataset metadata: %s', async (_reason, rows) => {
  const { request } = fakeRequest(rows);
  await expect(readDatasetIdentityFromRequest(request, 'e2e_exact')).rejects.toThrow(/metadata/);
});

test('refuses tree presence when the administrator dataset inventory says absent', async () => {
  const { request } = fakeRequest([exact], undefined, []);
  await expect(readDatasetIdentityFromRequest(request, 'e2e_exact')).rejects.toThrow(/inventories disagree/);
});

test('a 403 alone never proves absence when either inventory contains the dataset', async () => {
  const { request } = fakeRequest([exact], undefined, undefined, 403);
  await expect(readDatasetIdentityFromRequest(request, 'e2e_exact')).rejects.toThrow(/get-metadata.*status=403/);
});

test('failed inventories refuse even when deleted metadata would return 403', async () => {
  const { request } = fakeRequest([], [], [], 403, 403);
  await expect(readDatasetIdentityFromRequest(request, 'e2e_exact')).rejects.toThrow(/tree_data/);
});

test.each([
  ['malformed tree', {}, []], ['malformed dataset list', [], {}],
  ['malformed tree node', [null], []], ['malformed dataset entry', [], [{}]],
])('refuses unprovable absence: %s', async (_reason, nodes, datasets) => {
  const { request } = fakeRequest([], nodes, datasets, 403);
  await expect(readDatasetIdentityFromRequest(request, 'e2e_exact')).rejects.toThrow(/Malformed/);
});

test('never reads the timezone-less registry creation field or its misleading serialized Z', async () => {
  const { request } = fakeRequest([{ ...exact, get created() { throw new Error('Database clock read'); } }]);
  // JSON serialization is needed only for inventory responses, not named metadata.
  await expect(readDatasetIdentityFromRequest(request, 'e2e_exact')).resolves.toEqual({ tableUID: 919 });
});

test('refuses missing stable identity when the dataset catalogue still contains the exact name', async () => {
  const { request } = fakeRequest([], []);
  await expect(readDatasetIdentityFromRequest(request, 'e2e_exact')).rejects.toThrow(/exists.*stable table_uid/);
});

test.each(['present', 'absent'])
('Views root and unregistered views: parses the actual Go handler response for a %s confirmed dataset', async state => {
  const name = state === 'present' ? 'e2e_recorded' : 'e2e_deleted';
  const uid = state === 'present' ? 919 : 922;
  const { request, get } = fakeRequest([{ ...exact, table_name: name }], [],
    serverTreeResponse.nodes.filter(node => node.id.startsWith('t_'))
      .map(node => ({ dataset_name: node.name, table_uid: node.table_uid })));
  const originalGet = get.getMockImplementation()!;
  get.mockImplementation(async url => url === '/api/tree_data'
    ? { ok: () => true, status: () => 200, json: async () => serverTreeResponse,
      text: async () => JSON.stringify(serverTreeResponse) }
    : originalGet(url));
  expect(serverTreeResponse.nodes).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'views_root', name: 'views', db_id: -1 }),
    expect.objectContaining({ id: 'v_unregistered_view', is_view: true, parent_id: 'views_root' }),
    expect.objectContaining({ id: 't_registered_view', table_uid: '920' }),
    expect.objectContaining({ id: 't_nested_dataset', parent_id: 'f_919' }),
  ]));
  await expect(readDatasetIdentityFromRequest(request, name, uid))
    .resolves.toEqual(state === 'present' ? { tableUID: 919 } : null);
  if (state === 'absent') expect(get.mock.calls.map(([url]) => url)).not.toContain('/api/get-metadata');
});

test('Views root and unregistered views: registered SQL view remains a dataset for renamed-id refusal', async () => {
  const { request } = fakeRequest([], [datasetTreeNode('registered_view', '920')], [], 403);
  await expect(readDatasetIdentityFromRequest(request, 'old_registered_view', 920))
    .rejects.toThrow(/old_registered_view.*registered_view.*refusing renamed identity/);
});

test.each(['f_919', 'views_root', 'v_unregistered_view'])
('Views root and unregistered views: structural name collision %s is never a dataset', async id => {
  const structural = serverTreeResponse.nodes.find(node => node.id === id)!;
  const { request } = fakeRequest([], [{ ...structural, name: 'e2e_exact' }], [], 403);
  await expect(readDatasetIdentityFromRequest(request, 'e2e_exact', 919)).resolves.toBeNull();
});

test('Views root and unregistered views: a v_ view node with a registered UID is still structural', async () => {
  const view = serverTreeResponse.nodes.find(node => node.id === 'v_unregistered_view')!;
  const { request } = fakeRequest([], [{ ...view, table_uid: '919' }], [], 403);
  await expect(readDatasetIdentityFromRequest(request, 'e2e_exact', 919)).resolves.toBeNull();
});

test.each([
  { ...datasetTreeNode('renamed', undefined), is_view: true },
  { name: 'renamed' },
  { ...datasetTreeNode('renamed', '919'), id: 'unknown_kind' },
])('Views root and unregistered views: refuses dataset claim or unknown kind %j', async node => {
  const { request } = fakeRequest([], [node], [], 403);
  await expect(readDatasetIdentityFromRequest(request, 'e2e_exact', 919)).rejects.toThrow(/Malformed/);
});
