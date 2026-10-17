// dataset-language-key-cleanup.test.ts
// Exercises exact fixture language-key cleanup through mocked supported APIs.
// Covers derived/asset/column labels, protected baselines and independent failures.
// Guards against accepting a successful response when the key still exists.
import { beforeEach, expect, test, vi } from 'vitest';
import type { APIRequestContext } from '@playwright/test';
import { cleanupDatasetLanguageKeys } from './dataset-language-key-cleanup';

const state = vi.hoisted(() => ({
  rows: new Map<string, number>(), sources: new Map<string, Array<Record<string, unknown>>>(),
}));
vi.mock('./test-artifact-cleanup', () => ({
  readLangKeyInventory: async () => ({ allLangKeys: [...state.rows.keys()], totalLangKeyCount: state.rows.size }),
}));
vi.mock('./lang-key-source-inventory', () => ({
  readLangKeySources: async (_request: unknown, keys: string[]) =>
    new Map(keys.map(key => [key, state.sources.get(key) ?? []])),
}));
vi.mock('./test-artifact-csrf-reader', () => ({ fetchCsrfTokenForRequest: async () => 'fixture-csrf' }));

const dataset = 'e2e_j17_headings_exact';
const child = `${dataset}_assets`;
const columns = new Map([[dataset, ['name', 'event_date', 'owner_id']], [child, [`${dataset}_id`, 'filename']]]);
function api(failKey?: string, keepKey?: string) {
  const get = vi.fn(async (_url: string, options: { params: { lang_key_from: string; lang_key_to: string } }) => {
    const key = options.params.lang_key_from;
    expect(options.params.lang_key_to).toBe(key);
    const id = state.rows.get(key);
    return { ok: () => true, json: async () => ({ row_count: id ? 1 : 0, data: id ? [{ id, lang_key: key }] : [] }) };
  });
  const post = vi.fn(async (url: string, options: { data: { ids: number[] }; headers: Record<string, string> }) => {
    expect(url).toBe('/api/delete-rows?dataset=system_lang_keys');
    expect(options.headers['X-CSRF-Token']).toBe('fixture-csrf');
    expect(options.data.ids).toHaveLength(1);
    const key = [...state.rows].find(([, id]) => id === options.data.ids[0])?.[0];
    if (key === failKey) return { ok: () => false };
    if (key && key !== keepKey) state.rows.delete(key);
    return { ok: () => true };
  });
  return { request: { get, post } as unknown as APIRequestContext, post };
}

beforeEach(() => { state.rows.clear(); state.sources.clear(); });

test('removes every generated dataset/asset/column shape while preserving baseline and unrelated keys', async () => {
  const owned = [dataset, `add_row_${dataset}`, `search_for_${dataset}`, `search_slogan_${dataset}`,
    `${dataset}_front_page`, child, `add_row_${child}`, `${child}_front_page`,
    'event_date', 'search_for_event_date', 'event_date_asc', 'event_date_desc',
    `${dataset}_id`, `search_for_${dataset}_id`, `${dataset}_id_asc`, 'filename', 'owner_id_desc'];
  const protectedKeys = ['name', 'name_asc', `${dataset}_lookalike`, 'another_workers_key'];
  [...owned, ...protectedKeys].forEach((key, index) => state.rows.set(key, index + 1));
  state.sources.set('event_date', [{ source_type: 'column', source_high: dataset, source_low: 'event_date' }]);
  const { request, post } = api();
  await cleanupDatasetLanguageKeys(request, new Set(['name', 'name_asc']), columns);
  expect([...state.rows.keys()]).toEqual(protectedKeys);
  expect(post).toHaveBeenCalledTimes(owned.length);
});

test('after a failed deletion still removes other keys and reports the leftover; retry is idempotent', async () => {
  state.rows.set(`add_row_${dataset}`, 1); state.rows.set(`search_for_${dataset}`, 2);
  const first = api(`add_row_${dataset}`);
  await expect(cleanupDatasetLanguageKeys(first.request, new Set(), columns)).rejects.toThrow('language-key cleanup failed');
  expect([...state.rows.keys()]).toEqual([`add_row_${dataset}`]);
  expect(first.post).toHaveBeenCalledTimes(2);
  await cleanupDatasetLanguageKeys(api().request, new Set(), columns);
  expect(state.rows.size).toBe(0);
});

test('a successful delete response does not hide an undeleted key', async () => {
  state.rows.set(`add_row_${dataset}`, 1);
  await expect(cleanupDatasetLanguageKeys(api(undefined, `add_row_${dataset}`).request, new Set(), columns))
    .rejects.toThrow('language-key cleanup failed');
});

test('shared column keys used by another dataset are protected and reported', async () => {
  state.rows.set('event_date', 1); state.rows.set(`add_row_${dataset}`, 2);
  state.sources.set('event_date', [{ source_type: 'column', source_high: 'other_dataset', source_low: 'event_date' }]);
  const { request, post } = api();
  await expect(cleanupDatasetLanguageKeys(request, new Set(), columns)).rejects.toThrow('language-key cleanup failed');
  expect([...state.rows.keys()]).toEqual(['event_date']);
  expect(post).toHaveBeenCalledTimes(1);
});
