// home-settings.ts
// Snapshots/restores the six Home settings plus hero texts for real-writing specs.
// Uses supported Home APIs and application CRUD, with fresh presentation/article revisions.
// Keeps lost-response compensation inside the cleanup boundary and verifies every value.
import type { APIRequestContext, TestInfo } from '@playwright/test';
import { isDeepStrictEqual } from 'node:util';
import { fetchCsrfTokenForRequest } from './test-artifact-csrf-reader';
import { acquireHomeWriter, type HomeWriterLease } from './home-writer-lock';

const HOME_URL = '/api/admin/front-page';
const ARTICLES_URL = `${HOME_URL}/article-buttons`;
export const HOME_SWITCHES = ['separate_front_page', 'front_page_show_blocks',
  'front_page_button_shows_site_name', 'display_index_html_at_startup'] as const;
export type HomeState = {
  settings: Record<string, boolean>;
  hero: Record<string, { fi: string; en: string; usage_explanation: string; lang_key?: string }>;
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

/**
 * Lock the response's origin before reading any value used for restoration.
 * restore() keeps ownership; releaseWriter() belongs in the last cleanup's finally.
 * The shared afterEach retains its own reference across the body's restoration.
 */
export async function snapshotHomeSettings(request: APIRequestContext, label?: string) {
  // This first GET discovers the actual target, including redirects. Its JSON is
  // discarded: it may contain another writer's temporary values even if that
  // writer exits just before acquisition. Take a fresh snapshot UNDER the lock.
  const response = await request.get(HOME_URL);
  const writer = acquireHomeWriter(new URL(response.url()).origin, label);
  let captured = false;
  try {
    if (!response.ok()) throw new Error(`Home snapshot/readback failed: GET ${HOME_URL}, HTTP ${response.status()}`);
    const snapshot = await snapshotLockedHomeSettings(request, await read<HomeState>(request, HOME_URL), writer);
    captured = true;
    return snapshot;
  } finally {
    if (!captured) writer.release();
  }
}

// The Home hero save limits its request body to 32 KiB (front_page_admin.go:79), refuses NUL and values over 2000
// runes, and stores fi, en and usage_explanation through Go's strings.TrimSpace (Unicode White_Space;
// front_page_hero.go:72,89,109). A stored value it cannot reproduce could never be restored exactly (gates
// 253b/253c), so the snapshot refuses it before any mutation.
export const GO_SPACE = '[\\t\\n\\v\\f\\r \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]';
const EDGE_SPACE = new RegExp(`^${GO_SPACE}|${GO_SPACE}$`, 'u');
const HOME_POST_LIMIT_BYTES = 32 << 10;
function unrestorableHeroField(hero: HomeState['hero']): string | null {
  // Restoration POSTs exactly { hero: home.hero }, serialized as JSON.
  if (Buffer.byteLength(JSON.stringify({ hero }), 'utf8') > HOME_POST_LIMIT_BYTES) return 'payload (over 32 KiB)';
  for (const part of ['title', 'slogan', 'description']) {
    for (const field of ['fi', 'en', 'usage_explanation'] as const) {
      const value: unknown = hero?.[part]?.[field];
      if (typeof value !== 'string' || !value.isWellFormed() || value.includes('\0')
        || [...value].length > 2000 || EDGE_SPACE.test(value)) return `${part}.${field}`;
    }
  }
  return null;
}

async function snapshotLockedHomeSettings(originalRequest: APIRequestContext, home: HomeState, writer: HomeWriterLease) {
  const originalSwitches = switches(home);
  const unrestorable = unrestorableHeroField(home.hero);
  if (unrestorable) {
    throw new Error(`Home snapshot cannot be restored safely: hero ${unrestorable} has leading/trailing whitespace, NUL, `
      + 'over 2000 characters, invalid text or an oversized save body, which the Home API cannot store back exactly');
  }
  const articles = await read<HomeArticleSettings>(originalRequest, ARTICLES_URL);
  if (!Object.hasOwn(home, 'presentation') || !home.presentation_version || !articles.version
    || articles.configuration_error || articles.unavailable_items.length) {
    throw new Error('Home snapshot cannot be restored safely: invalid configuration or unavailable article targets');
  }

  const post = async (request: APIRequestContext, url: string, data: unknown, headers?: Record<string, string>) => {
    const response = await request.post(url, { headers: headers ?? { 'X-CSRF-Token': await fetchCsrfTokenForRequest(request) }, data });
    if (!response.ok()) throw new Error(`Home restoration failed: POST ${url}, HTTP ${response.status()}`);
  };

  const restoreArticleButtons = async (request = originalRequest) => {
    const headers = { 'X-CSRF-Token': await fetchCsrfTokenForRequest(request) };
    const latest = await read<HomeArticleSettings>(request, ARTICLES_URL);
    if (!isDeepStrictEqual(latest.article_buttons, articles.article_buttons)) {
      // An absent article setting reads as the canonical empty list. Its protected
      // API cannot restore absence; retain that established behaviour equivalence.
      await post(request, ARTICLES_URL, { article_buttons: articles.article_buttons, version: latest.version }, headers);
    }
    const restored = await read<HomeArticleSettings>(request, ARTICLES_URL);
    equal(restored.article_buttons, articles.article_buttons, 'front_page_article_buttons');
    equal(restored.configuration_error, articles.configuration_error, 'front_page_article_buttons configuration');
    equal(restored.unavailable_items, articles.unavailable_items, 'front_page_article_buttons targets');
    return restored;
  };

  const restoreHeroTexts = async (request = originalRequest) => {
    const latest = await read<HomeState>(request, HOME_URL);
    // front_page_hero.go accepts the complete admin hero, including lang_key.
    // Pass every captured part/field: omitted usage explanations are erased on save.
    if (!isDeepStrictEqual(latest.hero, home.hero)) await post(request, HOME_URL, { hero: home.hero });
    equal((await read<HomeState>(request, HOME_URL)).hero, home.hero, 'hero texts');
  };

  const verify = async (request = originalRequest) => {
    const failures: unknown[] = [];
    const attempt = async (step: () => Promise<void>) => { try { await step(); } catch (error) { failures.push(error); } };
    await attempt(async () => {
      const current = await read<HomeState>(request, HOME_URL);
      // Check individually so every mismatched switch is named in the aggregate.
      for (const key of HOME_SWITCHES) {
        try { equal(current.settings[key], originalSwitches[key], key); } catch (error) { failures.push(error); }
      }
      try { equal(current.hero, home.hero, 'hero texts'); } catch (error) { failures.push(error); }
      try { equal(current.presentation, home.presentation, 'front_page_presentation'); } catch (error) { failures.push(error); }
      if (home.presentation_version === 'none') equal(current.presentation_version, 'none', 'front_page_presentation absence');
    });
    await attempt(async () => {
      const current = await read<HomeArticleSettings>(request, ARTICLES_URL);
      equal(current.article_buttons, articles.article_buttons, 'front_page_article_buttons');
    });
    if (failures.length) throw new AggregateError(failures, 'Home settings readback failed');
  };

  const restore = async (request = originalRequest) => {
    const failures: unknown[] = [];
    const attempt = async (step: () => Promise<unknown>) => { try { await step(); } catch (error) { failures.push(error); } };
    await attempt(() => restoreHeroTexts(request));
    await attempt(() => restoreArticleButtons(request));
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
        await post(request, '/api/delete-rows?dataset=system_config', { ids: [rows.data[0].id] }, headers);
      } else if (!isDeepStrictEqual(latest.presentation, home.presentation)) {
        await post(request, HOME_URL, { presentation: home.presentation, version: latest.presentation_version }, headers);
      }
    });
    await attempt(async () => {
      const latest = await read<HomeState>(request, HOME_URL);
      if (!isDeepStrictEqual(switches(latest), originalSwitches)) await post(request, HOME_URL, { settings: originalSwitches });
    });
    // A failed restore never prevents readback, or silently passes with a failed body.
    await attempt(() => verify(request));
    if (failures.length) {
      console.error('Home settings restoration/readback failures:', failures);
      throw new AggregateError(failures, 'Home settings restoration/readback failed');
    }
  };
  return { home, articles, restoreHeroTexts, restoreArticleButtons, restore, verify,
    releaseWriter: writer.release, retainWriter: () => writer.retain().release };
}

export type HomeSettingsSnapshot = Awaited<ReturnType<typeof snapshotHomeSettings>>;

/** Second cleanup line for timeout hooks, also used by T18's worker afterAll. */
export async function runHomeTimeoutBackstop(request: APIRequestContext, snapshot: HomeSettingsSnapshot) {
  const failures: unknown[] = [];
  const attempt = async (name: string, action: () => Promise<void>) => {
    try { await action(); }
    catch (error) { failures.push(new Error(`${name}: ${error instanceof Error ? error.message : String(error)}`, { cause: error })); }
  };
  // Every nested operation uses the supplied teardown context, never the page's
  // captured transport, which Playwright may already have closed on timeout.
  await attempt('hero restore', () => snapshot.restoreHeroTexts(request));
  await attempt('presentation re-save', async () => {
    if (snapshot.home.presentation_version === 'none') return;
    const latest = await read<HomeState>(request, HOME_URL);
    // Unconditional: the store stamps updated=clock_timestamp() even for equal values.
    // A stale presentation POST then conflicts. Other requests still in flight may
    // commit later; the supervisor's before/after comparison stops publication.
    const response = await request.post(HOME_URL, {
      headers: { 'X-CSRF-Token': await fetchCsrfTokenForRequest(request) },
      data: { presentation: snapshot.home.presentation, version: latest.presentation_version },
    });
    if (!response.ok()) throw new Error(`Home presentation re-save failed: HTTP ${response.status()}`);
  });
  await attempt('full restore/readback', () => snapshot.restore(request));
  if (failures.length) throw new AggregateError(failures, 'Home timeout backstop failed');
}

/** Register one pre-fixture-teardown hook; arm immediately after taking each snapshot. */
export function homeTimeoutBackstop(test: {
  afterEach: (hook: (fixtures: object, info: TestInfo) => Promise<void>) => void;
}) {
  let armed: Array<{ request: APIRequestContext; snapshot: HomeSettingsSnapshot; release: () => void }> = [];
  test.afterEach(async ({}, info) => {
    const current = armed;
    armed = [];
    if (!current.length) return;
    const failures: unknown[] = [];
    // Separate after-hooks slot (Playwright 1.60): allow API cleanup 60 s even
    // when T22 deliberately exhausts a much shorter body timeout.
    try {
      info.setTimeout(60_000);
      // Nested/repeated snapshots unwind to the earliest original values.
      for (const item of current.reverse()) {
        try { await runHomeTimeoutBackstop(item.request, item.snapshot); }
        catch (error) { failures.push(error); }
      }
    } catch (error) {
      failures.push(error);
    } finally {
      // The body may already have released its snapshot reference. The separate
      // hook reference keeps ownership uninterrupted until ALL backstops finish.
      for (const item of current) {
        try { try { item.snapshot.releaseWriter(); } finally { item.release(); } }
        catch (error) { failures.push(error); }
      }
    }
    if (failures.length) throw new AggregateError(failures, 'Home timeout backstop failed');
  });
  return (request: APIRequestContext, snapshot: HomeSettingsSnapshot) => {
    armed.push({ request, snapshot, release: snapshot.retainWriter() });
  };
}

/** Enter cleanup before the callback's first mutation, including a lost POST response. */
export async function withHomeSettings<T>(request: APIRequestContext,
  body: (snapshot: HomeSettingsSnapshot) => Promise<T>, label?: string): Promise<T> {
  const snapshot = await snapshotHomeSettings(request, label);
  const failures: unknown[] = [];
  try { return await body(snapshot); }
  catch (error) { failures.push(error); throw error; }
  finally {
    const cleanupFailures: unknown[] = [];
    try { await snapshot.restore(); }
    catch (error) { cleanupFailures.push(error); }
    finally {
      try { snapshot.releaseWriter(); } catch (error) { cleanupFailures.push(error); }
    }
    if (cleanupFailures.length) throw new AggregateError([...failures, ...cleanupFailures], 'Home body or restoration failed');
  }
}
