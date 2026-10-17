// home-settings.ts
// Snapshots and restores all six Home settings for real-writing administrator specs.
// Uses supported Home APIs and application CRUD, with fresh presentation/article revisions.
// Keeps lost-response compensation inside the cleanup boundary and verifies every value.
import type { APIRequestContext } from '@playwright/test';
import { isDeepStrictEqual } from 'node:util';
import { fetchCsrfTokenForRequest } from './test-artifact-csrf-reader';

const HOME_URL = '/api/admin/front-page';
const ARTICLES_URL = `${HOME_URL}/article-buttons`;
export const HOME_SWITCHES = ['separate_front_page', 'front_page_show_blocks',
  'front_page_button_shows_site_name', 'display_index_html_at_startup'] as const;
export type HomeState = {
  settings: Record<string, boolean>;
  hero: Record<string, { fi: string; en: string; usage_explanation: string }>;
  presentation: unknown; presentation_version: string;
  site_root: { path: string; exists: boolean; ready: boolean; status_error: boolean };
};
export type HomeArticleSettings = {
  article_buttons: { schema_version: number; placement: 'below_text' | 'top_row';
    items: Array<{ table_uid: number; row_id: string; enabled: boolean }> };
  version: string; unavailable_items: unknown[]; configuration_error: string;
};

async function read<T>(request: APIRequestContext, url: string): Promise<T> {
  const response = await request.get(url);
  if (!response.ok()) throw new Error(`Home snapshot/readback failed: GET ${url}, HTTP ${response.status()}`);
  return response.json() as Promise<T>;
}

function equal(actual: unknown, expected: unknown, setting: string) {
  if (!isDeepStrictEqual(actual, expected)) throw new Error(`Home cleanup mismatch: ${setting}`);
}

function switches(home: HomeState) {
  return Object.fromEntries(HOME_SWITCHES.map(key => {
    if (typeof home.settings?.[key] !== 'boolean') throw new Error(`Home snapshot/readback missing switch: ${key}`);
    return [key, home.settings[key]];
  }));
}

/** Read all six before returning control to any mutating body or beforeEach. */
export async function snapshotHomeSettings(request: APIRequestContext) {
  const home = await read<HomeState>(request, HOME_URL);
  const originalSwitches = switches(home);
  const articles = await read<HomeArticleSettings>(request, ARTICLES_URL);
  if (!Object.hasOwn(home, 'presentation') || !home.presentation_version || !articles.version
    || articles.configuration_error || articles.unavailable_items.length) {
    throw new Error('Home snapshot cannot be restored safely: invalid configuration or unavailable article targets');
  }

  const post = async (url: string, data: unknown, headers?: Record<string, string>) => {
    const response = await request.post(url, { headers: headers ?? { 'X-CSRF-Token': await fetchCsrfTokenForRequest(request) }, data });
    if (!response.ok()) throw new Error(`Home restoration failed: POST ${url}, HTTP ${response.status()}`);
  };

  const restoreArticleButtons = async () => {
    const headers = { 'X-CSRF-Token': await fetchCsrfTokenForRequest(request) };
    const latest = await read<HomeArticleSettings>(request, ARTICLES_URL);
    if (!isDeepStrictEqual(latest.article_buttons, articles.article_buttons)) {
      // An absent article setting reads as the canonical empty list. Its protected
      // API cannot restore absence; retain that established behaviour equivalence.
      await post(ARTICLES_URL, { article_buttons: articles.article_buttons, version: latest.version }, headers);
    }
    const restored = await read<HomeArticleSettings>(request, ARTICLES_URL);
    equal(restored.article_buttons, articles.article_buttons, 'front_page_article_buttons');
    equal(restored.configuration_error, articles.configuration_error, 'front_page_article_buttons configuration');
    equal(restored.unavailable_items, articles.unavailable_items, 'front_page_article_buttons targets');
    return restored;
  };

  const verify = async () => {
    const failures: unknown[] = [];
    const attempt = async (step: () => Promise<void>) => { try { await step(); } catch (error) { failures.push(error); } };
    await attempt(async () => {
      const current = await read<HomeState>(request, HOME_URL);
      // Check individually so every mismatched switch is named in the aggregate.
      for (const key of HOME_SWITCHES) {
        try { equal(current.settings[key], originalSwitches[key], key); } catch (error) { failures.push(error); }
      }
      equal(current.presentation, home.presentation, 'front_page_presentation');
      if (home.presentation_version === 'none') equal(current.presentation_version, 'none', 'front_page_presentation absence');
    });
    await attempt(async () => {
      const current = await read<HomeArticleSettings>(request, ARTICLES_URL);
      equal(current.article_buttons, articles.article_buttons, 'front_page_article_buttons');
    });
    if (failures.length) throw new AggregateError(failures, 'Home settings readback failed');
  };

  const restore = async () => {
    const failures: unknown[] = [];
    const attempt = async (step: () => Promise<unknown>) => { try { await step(); } catch (error) { failures.push(error); } };
    await attempt(restoreArticleButtons);
    await attempt(async () => {
      const headers = { 'X-CSRF-Token': await fetchCsrfTokenForRequest(request) };
      const latest = await read<HomeState>(request, HOME_URL);
      if (home.presentation_version === 'none') {
        if (latest.presentation_version === 'none') return;
        // Remove only the setting introduced by the test, through supported CRUD.
        const query = new URLSearchParams({ dataset: 'system_config', view_key: 'table', key_from: 'front_page_presentation', key_to: 'front_page_presentation' });
        const rows = await read<{ data: Array<{ id: number; key: string }> }>(request, `/api/get-results?${query}`);
        if (rows.data.length !== 1 || rows.data[0].key !== 'front_page_presentation') {
          throw new Error('Home restoration cannot identify the introduced front_page_presentation row');
        }
        await post('/api/delete-rows?dataset=system_config', { ids: [rows.data[0].id] }, headers);
      } else if (!isDeepStrictEqual(latest.presentation, home.presentation)) {
        await post(HOME_URL, { presentation: home.presentation, version: latest.presentation_version }, headers);
      }
    });
    await attempt(async () => {
      const latest = await read<HomeState>(request, HOME_URL);
      if (!isDeepStrictEqual(switches(latest), originalSwitches)) await post(HOME_URL, { settings: originalSwitches });
    });
    // A failed restore never prevents readback, or silently passes with a failed body.
    await attempt(verify);
    if (failures.length) {
      console.error('Home settings restoration/readback failures:', failures);
      throw new AggregateError(failures, 'Home settings restoration/readback failed');
    }
  };
  return { home, articles, restoreArticleButtons, restore, verify };
}

/** Enter cleanup before the callback's first mutation, including a lost POST response. */
export async function withHomeSettings<T>(request: APIRequestContext,
  body: (snapshot: Awaited<ReturnType<typeof snapshotHomeSettings>>) => Promise<T>): Promise<T> {
  const snapshot = await snapshotHomeSettings(request);
  const failures: unknown[] = [];
  try { return await body(snapshot); }
  catch (error) { failures.push(error); throw error; }
  finally {
    try { await snapshot.restore(); }
    catch (error) { throw new AggregateError([...failures, error], 'Home body or restoration failed'); }
  }
}
