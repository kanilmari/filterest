/** Exercises exact filtering, complete pagination and fail-closed attribution without a server. */
import type { APIRequestContext } from '@playwright/test';
import { beforeEach, expect, test, vi } from 'vitest';
const contextFactory = vi.hoisted(() => vi.fn());
vi.mock('@playwright/test', () => ({ request: { newContext: contextFactory } }));
import { readLangKeySources, readLangKeySourcesWithStorageState } from './lang-key-source-inventory';
import { attributeLangKeyDrift } from './lang-key-drift-attribution';

const dataset = 'e2e_this_run_123';
const key = `add_row_${dataset}`;
const translation = { id: 3, lang_key_id: 17, source_type: 'foreign_key',
  source_high: 'public.system_lang_key_translations.lang_key_id', source_low: 'lang_key_id' };
const response = (body: unknown) => ({ ok: () => true, status: () => 200, json: async () => body });

function api(pages: Array<{ data: unknown[]; row_count: number }> = [{ data: [translation], row_count: 1 }]) {
  const get = vi.fn(async (url: string, options?: { params: Record<string, unknown> }) => {
    if (url === '/api/admin/version-info') return response({});
    const params = options!.params;
    if (params.dataset === 'system_lang_keys') return response({ data: [{ id: 17, lang_key: key }], row_count: 1 });
    return response(pages[Number(params.offset)] ?? { data: [], row_count: 1 });
  });
  const dispose = vi.fn();
  return { get, dispose, request: { get, dispose } as unknown as APIRequestContext };
}

beforeEach(() => { vi.clearAllMocks(); });

test('reads exact key identity and translation reference through GETs only', async () => {
  const mock = api();
  const sources = await readLangKeySources(mock.request, [key]);
  expect(attributeLangKeyDrift([key], [], [dataset], sources).retainedOwnRun).toEqual([key]);
  expect(mock.get).toHaveBeenCalledWith('/api/get-results', { params: {
    dataset: 'system_lang_keys', view_key: 'table', lang_key_from: key, lang_key_to: key,
    offset: 0, sort_column: 'id', sort_order: 'ASC',
  } });
  expect(mock.get).toHaveBeenCalledWith('/api/get-results', { params: {
    dataset: 'system_lang_key_sources', view_key: 'table', lang_key_id_from: 17, lang_key_id_to: 17,
    offset: 0, sort_column: 'id', sort_order: 'ASC',
  } });
});

test('negative control: another counting source on the second page rejects an own-looking key', async () => {
  const other = { ...translation, id: 4, source_type: 'code', source_high: 'other.js', source_low: '' };
  const mock = api([{ data: [translation], row_count: 2 }, { data: [other], row_count: 2 }]);
  const sources = await readLangKeySources(mock.request, [key]);
  expect(attributeLangKeyDrift([key], [], [dataset], sources))
    .toEqual({ retainedOwnRun: [], unexplainedAdded: [key], removed: [] });
  expect(mock.get.mock.calls.at(-1)![1]!.params.offset).toBe(1);
});

test('zero remaining sources is explicit evidence after dataset cleanup', async () => {
  const sources = await readLangKeySources(api([{ data: [], row_count: 0 }]).request, [key]);
  expect(sources.get(key)).toEqual([]);
});

test.each([
  [{ data: [], row_count: 1 }],
  [{ data: [translation], row_count: 2 }, { data: [], row_count: 2 }],
  [{ data: [translation], row_count: 2 }, { data: [translation], row_count: 2 }],
  [{ data: [translation], row_count: 2 }, { data: [], row_count: 0 }],
  [{ data: [{ ...translation, lang_key_id: 99 }], row_count: 1 }],
  [{ data: [{ ...translation, source_type: undefined }], row_count: 1 }],
])('unprovable source inventory fails closed: %j', async (...pages) => {
  await expect(readLangKeySources(api(pages).request, [key])).rejects.toThrow(/Incomplete or malformed/);
});

test('missing row counts and failed administrator reads cannot authorize retention', async () => {
  const mock = api();
  mock.get.mockResolvedValueOnce({ ok: () => false, status: () => 403 } as never);
  await expect(readLangKeySources(mock.request, [key])).rejects.toThrow(/HTTP request failed/);
  expect(mock.get).toHaveBeenCalledTimes(1);
  const missingCount = api();
  missingCount.get.mockResolvedValueOnce(response({})).mockResolvedValueOnce(response({ data: [] }));
  await expect(readLangKeySources(missingCount.request, [key])).rejects.toThrow(/Incomplete or malformed/);
});

test('storage-state reader disposes its context on success and failure without loading credentials', async () => {
  const mock = api();
  contextFactory.mockResolvedValue(mock.request);
  await readLangKeySourcesWithStorageState('https://localhost:9999', '/tmp/state.json', [key]);
  expect(contextFactory).toHaveBeenCalledWith(expect.objectContaining({ storageState: '/tmp/state.json' }));
  expect(mock.dispose).toHaveBeenCalledTimes(1);
  mock.get.mockRejectedValueOnce(new Error('private transport contents'));
  await expect(readLangKeySourcesWithStorageState('https://localhost:9999', '/tmp/state.json', [key]))
    .rejects.toThrow(/request transport failed/);
  expect(mock.dispose).toHaveBeenCalledTimes(2);
});
