// home-settings.test.ts
// Proves six-setting snapshots, lost-response compensation and loud cleanup failures.
// Exercises the shared E2E helper with in-memory supported-API responses only.
// No browser, server, database or persistent settings are used.
import { afterEach, expect, test, vi } from 'vitest';
import type { APIRequestContext } from '@playwright/test';
import { HOME_SWITCHES, snapshotHomeSettings, withHomeSettings, type HomeState, type HomeArticleSettings } from './home-settings';

vi.mock('./test-artifact-csrf-reader', () => ({ fetchCsrfTokenForRequest: async () => 'fixture' }));
afterEach(() => vi.restoreAllMocks());

function fixture(absent = false) {
  const originalHome: HomeState = { settings: { separate_front_page: false, front_page_show_blocks: true,
    front_page_button_shows_site_name: false, display_index_html_at_startup: true }, hero: {},
    presentation: absent ? null : { alignment: 'left' }, presentation_version: absent ? 'none' : 'p1',
    site_root: { path: '', exists: false, ready: false, status_error: false } };
  const originalArticles: HomeArticleSettings = { article_buttons: { schema_version: 1, placement: 'below_text', items: [] },
    version: absent ? 'none' : 'a1', unavailable_items: [], configuration_error: '' };
  const state = { home: structuredClone(originalHome), articles: structuredClone(originalArticles) };
  const controls = { loseResponse: false, ignoreRestore: '', failArticles: false };
  const events: string[] = [];
  const response = (data: unknown, status = 200) => ({ ok: () => status === 200, status: () => status,
    json: async () => structuredClone(data) });
  const request = {
    get: vi.fn(async (url: string) => {
      events.push(`GET ${url}`);
      if (url.includes('/api/get-results?')) return response({ data: [{ id: 7, key: 'front_page_presentation' }] });
      return response(url.endsWith('/article-buttons') ? state.articles : state.home);
    }),
    post: vi.fn(async (url: string, { data }: { data: Record<string, any> }) => {
      events.push(`POST ${url}`);
      if (url.endsWith('/article-buttons')) {
        if (controls.failArticles) return response({}, 500);
        if (controls.ignoreRestore !== 'front_page_article_buttons') state.articles.article_buttons = structuredClone(data.article_buttons);
        state.articles.version = 'a2';
      } else if (url.includes('/api/delete-rows?')) {
        state.home.presentation = null; state.home.presentation_version = 'none';
      } else {
        for (const key of HOME_SWITCHES) if (data.settings && controls.ignoreRestore !== key) state.home.settings[key] = data.settings[key];
        if ('presentation' in data && controls.ignoreRestore !== 'front_page_presentation') {
          state.home.presentation = structuredClone(data.presentation); state.home.presentation_version = 'p2';
        }
      }
      if (controls.loseResponse) { controls.loseResponse = false; throw new Error('committed POST response lost'); }
      return response({});
    }),
  } as unknown as APIRequestContext;
  const mutate = async () => {
    await request.post('/api/admin/front-page', { data: {
      settings: Object.fromEntries(HOME_SWITCHES.map(key => [key, !originalHome.settings[key]])),
      presentation: { alignment: 'right' },
    } });
    await request.post('/api/admin/front-page/article-buttons', { data: { article_buttons: {
      schema_version: 1, placement: 'top_row', items: [{ table_uid: 3, row_id: '1', enabled: true }],
    } } });
  };
  return { request, state, controls, events, originalHome, originalArticles, mutate };
}

function messages(error: unknown): string {
  return error instanceof AggregateError ? `${error.message} ${error.errors.map(messages).join(' ')}` : String(error);
}

test('snapshots all six before returning control, without a write', async () => {
  const f = fixture();
  const snapshot = await snapshotHomeSettings(f.request);
  expect(snapshot.home).toEqual(f.originalHome); expect(snapshot.articles).toEqual(f.originalArticles);
  expect(f.events).toEqual(['GET /api/admin/front-page', 'GET /api/admin/front-page/article-buttons']);
});

test('cleanup covers the first POST even when it commits and loses its response', async () => {
  const f = fixture(); f.controls.loseResponse = true;
  await expect(withHomeSettings(f.request, async () => { await f.mutate(); })).rejects.toThrow('committed POST response lost');
  expect(f.events.slice(0, 3)).toEqual(['GET /api/admin/front-page', 'GET /api/admin/front-page/article-buttons', 'POST /api/admin/front-page']);
  expect(f.state.home.settings).toEqual(f.originalHome.settings);
  expect(f.state.home.presentation).toEqual(f.originalHome.presentation);
  expect(f.events.slice(-2)).toEqual(['GET /api/admin/front-page', 'GET /api/admin/front-page/article-buttons']);
});

test('a failed body restores and reads back all six settings', async () => {
  const f = fixture();
  await expect(withHomeSettings(f.request, async () => { await f.mutate(); throw new Error('body failed'); })).rejects.toThrow('body failed');
  expect(f.state.home.settings).toEqual(f.originalHome.settings);
  expect(f.state.home.presentation).toEqual(f.originalHome.presentation);
  expect(f.state.articles.article_buttons).toEqual(f.originalArticles.article_buttons);
});

test.each([...HOME_SWITCHES, 'front_page_article_buttons', 'front_page_presentation'])(
  'a successful restore response with mismatched %s fails loudly', async setting => {
    const f = fixture(); vi.spyOn(console, 'error').mockImplementation(() => {});
    let failure: unknown;
    try {
      await withHomeSettings(f.request, async () => { await f.mutate(); f.controls.ignoreRestore = setting; });
    } catch (error) { failure = error; }
    expect(messages(failure)).toContain(`Home cleanup mismatch: ${setting}`);
    expect(f.events.slice(-2)).toEqual(['GET /api/admin/front-page', 'GET /api/admin/front-page/article-buttons']);
  });

test('a restore failure still restores the other settings, verifies and reports body plus cleanup', async () => {
  const f = fixture(); vi.spyOn(console, 'error').mockImplementation(() => {});
  let failure: unknown;
  try {
    await withHomeSettings(f.request, async () => { await f.mutate(); f.controls.failArticles = true; throw new Error('body failed'); });
  } catch (error) { failure = error; }
  expect(messages(failure)).toContain('body failed'); expect(messages(failure)).toContain('HTTP 500');
  expect(messages(failure)).toContain('Home cleanup mismatch: front_page_article_buttons');
  expect(f.state.home.settings).toEqual(f.originalHome.settings);
  expect(f.state.home.presentation).toEqual(f.originalHome.presentation);
});

test('restores absent presentation through CRUD and absent articles as the canonical empty list', async () => {
  const f = fixture(true);
  await withHomeSettings(f.request, async () => { await f.mutate(); });
  expect(f.events).toContain('POST /api/delete-rows?dataset=system_config');
  expect(f.state.home.presentation_version).toBe('none'); expect(f.state.home.presentation).toBeNull();
  expect(f.state.articles.article_buttons).toEqual(f.originalArticles.article_buttons);
});
