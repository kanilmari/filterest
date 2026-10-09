// appearance-revisions.test.ts
// Proves fresh revision loads, bounded conflict retries and exact sparse restores.
// Connects mocked authenticated API responses to E2E setup and cleanup helpers.
// Keeps a cleanup failure observable without a browser or installation database.
import { describe, expect, it, vi } from 'vitest';
import type { APIRequestContext } from '@playwright/test';
import type { DatasetAppearanceResponse } from '../../../frontend/generated/go_contract_types';
import {
  loadDatasetCardVisibility,
  restoreDatasetAppearance,
  restoreSitePresentationSettings,
  saveCardVisibilityWithFreshRevisions,
  type SitePresentationSettings,
} from './appearance-revisions';

function appearance(version = '1', sharedVersion = 'shared-1', datasetUID = 7) {
  return { dataset_uid: datasetUID, version, shared_version: sharedVersion, overrides: {},
    shared: {}, effective: {}, sources: {}, schema_version: 1 } as DatasetAppearanceResponse;
}

function settings(version = 'shared-original') {
  return { version, dataset_cover_theme: { light: {}, dark: {}, shared: { card_style_variant: 'modern' } },
    row_article_timestamp_display_mode: 'date_time' } as SitePresentationSettings;
}

function apiResponse(status: number, data: unknown) {
  return { ok: () => status >= 200 && status < 300, status: () => status,
    text: async () => JSON.stringify(data), json: async () => data, dispose: vi.fn(async () => {}) };
}

function fixture(
  snapshots: DatasetAppearanceResponse[] = [appearance()],
  posts: Array<ReturnType<typeof apiResponse>> = [apiResponse(200, {})],
  sharedSettings = [settings()],
) {
  const events: string[] = [];
  let snapshotIndex = 0, sharedIndex = 0, postIndex = 0;
  const get = vi.fn(async (url: string) => {
    events.push(`GET ${url}`);
    if (url === '/api/csrf-token') return apiResponse(200, { csrf_token: 'test-token' });
    if (url === '/api/admin/site-presentation-settings') {
      return apiResponse(200, sharedSettings[Math.min(sharedIndex++, sharedSettings.length - 1)]);
    }
    return apiResponse(200, { table_name: 'fixture', columns: [], card_style_variant: null,
      card_detail_columns: null, dataset_appearance: snapshots[Math.min(snapshotIndex++, snapshots.length - 1)] });
  });
  const post = vi.fn(async (url: string, _options: unknown) => {
    events.push(`POST ${url}`);
    return posts[Math.min(postIndex++, posts.length - 1)];
  });
  return { request: { get, post } as unknown as APIRequestContext, get, post, events };
}

describe('appearance API revisions', () => {
  it('attaches the current dataset and shared revisions after obtaining CSRF, including none', async () => {
    const { request, post, events } = fixture([appearance('none', 'new-shared')]);
    await saveCardVisibilityWithFreshRevisions(request, 'fixture', () => ({
      columns: [], card_style_variant: null, version: 'stale', shared_version: 'stale',
    }));
    expect(post.mock.calls[0]).toEqual(['/api/card-visibility/update', {
      data: { columns: [], card_style_variant: null, table_name: 'fixture', version: 'none', shared_version: 'new-shared' },
      headers: { 'X-CSRF-Token': 'test-token' },
    }]);
    expect(events).toEqual(['GET /api/csrf-token', 'GET /api/card-visibility/fixture', 'POST /api/card-visibility/update']);
  });

  it('refuses an ordinary save conflict without rebasing the test write', async () => {
    const { request, post } = fixture([appearance()], [apiResponse(409, { error: 'reload before saving' })]);
    await expect(saveCardVisibilityWithFreshRevisions(request, 'fixture', () => ({})))
      .rejects.toThrow(/save.*1 attempt.*409.*reload before saving/);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it.each(['version', 'shared_version'] as const)('refuses missing %s before sending a write', async field => {
    const snapshot = appearance(); snapshot[field] = '';
    const { request, post } = fixture([snapshot]);
    await expect(saveCardVisibilityWithFreshRevisions(request, 'fixture', () => ({})))
      .rejects.toThrow(/Missing .* appearance revision/);
    expect(post).not.toHaveBeenCalled();
  });

  it('refuses a mismatched dataset name in the metadata response', async () => {
    const { request } = fixture();
    await expect(loadDatasetCardVisibility(request, 'replacement')).rejects.toThrow(/Invalid appearance identity/);
  });

  it('restores explicit values and inheritance, reloads both revisions on 409 and preserves unrelated leaves', async () => {
    const original = { ...appearance(), overrides: { 'shared.card_style_variant': 'standard', 'light.image_opacity': 0.4 } };
    const restored = { ...appearance('4', 'shared-3'), overrides: {
      'shared.card_style_variant': 'standard', 'light.image_opacity': 0.8,
    } };
    const { request, post, events } = fixture([appearance('2', 'shared-2'), appearance('3', 'shared-3')], [
      apiResponse(409, { error: 'dataset appearance changed' }), apiResponse(200, restored),
    ]);
    await restoreDatasetAppearance(request, 'fixture', original, ['shared.card_style_variant', 'shared.card_detail_columns']);
    const first = post.mock.calls[0][1] as { data: Record<string, unknown> };
    const second = post.mock.calls[1][1] as { data: Record<string, unknown> };
    expect(first.data).toEqual({ dataset_uid: 7, version: '2', shared_version: 'shared-2',
      set: { 'shared.card_style_variant': 'standard' }, unset: ['shared.card_detail_columns'] });
    expect(second.data).toEqual({ ...first.data, version: '3', shared_version: 'shared-3' });
    expect(events).toEqual(['GET /api/csrf-token', 'GET /api/card-visibility/fixture', 'POST /api/admin/dataset-appearance',
      'GET /api/card-visibility/fixture', 'POST /api/admin/dataset-appearance']);
  });

  it('stops a dataset restore loudly after the second conflict', async () => {
    const { request, post, get } = fixture([appearance()], [apiResponse(409, { error_lang_key: 'dataset_appearance_conflict' })]);
    await expect(restoreDatasetAppearance(request, 'fixture', appearance(), ['shared.card_style_variant']))
      .rejects.toThrow(/restore.*2 attempt.*409.*dataset_appearance_conflict/);
    expect(post).toHaveBeenCalledTimes(2);
    expect(get.mock.calls.filter(([url]) => url.startsWith('/api/card-visibility/'))).toHaveLength(2);
  });

  it('does not retry a restore refused for another reason', async () => {
    const { request, post } = fixture([appearance()], [apiResponse(403, { error: 'forbidden' })]);
    await expect(restoreDatasetAppearance(request, 'fixture', appearance(), []))
      .rejects.toThrow(/restore.*1 attempt.*403.*forbidden/);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('refuses a restore against a dataset replaced between conflict retries', async () => {
    const { request, post } = fixture([appearance(), appearance('2', 'shared-2', 8)], [apiResponse(409, {})]);
    await expect(restoreDatasetAppearance(request, 'fixture', appearance(), []))
      .rejects.toThrow(/was replaced/);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('rejects successful restore responses that retain a leaf meant to inherit', async () => {
    const { request } = fixture([appearance()], [apiResponse(200, {
      ...appearance('2'), overrides: { 'shared.card_style_variant': 'modern' },
    })]);
    await expect(restoreDatasetAppearance(request, 'fixture', appearance(), ['shared.card_style_variant']))
      .rejects.toThrow(/restore returned different overrides/);
  });

  it('restores original shared values using revisions reloaded before both attempts', async () => {
    const original = settings();
    const { request, post, events } = fixture([], [apiResponse(409, {}), apiResponse(200, { ...original, version: 'saved' })],
      [settings('fresh-1'), settings('fresh-2')]);
    await restoreSitePresentationSettings(request, original);
    expect(post.mock.calls[0][1]).toEqual({ data: { ...original, version: 'fresh-1' }, headers: { 'X-CSRF-Token': 'test-token' } });
    expect(post.mock.calls[1][1]).toEqual({ data: { ...original, version: 'fresh-2' }, headers: { 'X-CSRF-Token': 'test-token' } });
    expect(events).toEqual(['GET /api/csrf-token', 'GET /api/admin/site-presentation-settings', 'POST /api/admin/site-presentation-settings',
      'GET /api/admin/site-presentation-settings', 'POST /api/admin/site-presentation-settings']);
  });

  it('stops shared restoration loudly after a repeated conflict', async () => {
    const { request, post } = fixture([], [apiResponse(409, { error: 'reload before saving' })]);
    await expect(restoreSitePresentationSettings(request, settings())).rejects.toThrow(/restore.*2 attempt.*409.*reload before saving/);
    expect(post).toHaveBeenCalledTimes(2);
  });
});
