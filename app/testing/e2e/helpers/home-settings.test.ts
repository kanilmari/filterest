// home-settings.test.ts
// Proves six-setting/hero snapshots, timeout compensation and loud cleanup failures.
// Exercises the shared E2E helper with in-memory supported-API responses only.
// No browser, server, database or persistent settings are used.
import { afterEach, expect, test, vi } from 'vitest';
import type { APIRequestContext, TestInfo } from '@playwright/test';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { createHomeWriterLock } from './home-writer-lock';
import { GO_SPACE, HOME_SWITCHES, homeTimeoutBackstop, runHomeTimeoutBackstop, snapshotHomeSettings,
  withHomeSettings, type HomeState, type HomeArticleSettings, type HomeSettingsSnapshot } from './home-settings';

const goTrim = (value: string) => value.replace(new RegExp(`^${GO_SPACE}+|${GO_SPACE}+$`, 'gu'), '');

vi.mock('./test-artifact-csrf-reader', () => ({ fetchCsrfTokenForRequest: async () => 'fixture' }));
const snapshots: Array<{ releaseWriter: () => void }> = [];
const temporaryLockPaths: string[] = [];
async function trackedSnapshot(request: APIRequestContext) {
  const saved = await snapshotHomeSettings(request);
  snapshots.push(saved);
  return saved;
}
afterEach(() => {
  for (const saved of snapshots.splice(0)) saved.releaseWriter();
  for (const path of temporaryLockPaths.splice(0)) fs.rmSync(path, { force: true, recursive: true });
  vi.restoreAllMocks();
});

function fixture(absent = false, presentation: unknown = { alignment: 'left' }) {
  const originalHome: HomeState = { settings: { separate_front_page: false, front_page_show_blocks: true,
    front_page_button_shows_site_name: false, display_index_html_at_startup: true },
    hero: Object.fromEntries(['title', 'slogan', 'description'].map(part => [part, {
      fi: `Alkuperäinen ${part}`, en: `Original ${part}`, usage_explanation: `Reviewed ${part}`, lang_key: `site_front_page_${part}`,
    }])),
    presentation: absent ? null : presentation, presentation_version: absent ? 'none' : 'p1',
    site_root: { path: '', exists: false, ready: false, status_error: false } };
  const originalArticles: HomeArticleSettings = { article_buttons: { schema_version: 1, placement: 'below_text', items: [] },
    version: absent ? 'none' : 'a1', unavailable_items: [], configuration_error: '' };
  const state = { home: structuredClone(originalHome), articles: structuredClone(originalArticles) };
  const controls = { loseResponse: false, ignoreRestore: '', failArticles: false, failPresentation: false };
  let presentationRevision = 1;
  const events: string[] = [];
  const origin = `https://home-${crypto.randomUUID()}.invalid`;
  temporaryLockPaths.push(`${tmpdir()}/filterest-home-writer-${createHash('sha256').update(origin).digest('hex')}.lock`);
  const response = (data: unknown, status = 200) => ({ ok: () => status === 200, status: () => status, url: () => `${origin}/api/admin/front-page`,
    json: async () => structuredClone(data) });
  const request = {
    get: vi.fn(async (url: string) => {
      events.push(`GET ${url}`);
      if (url.includes('/api/get-results?')) return response({ data: [{ id: 7, key: 'front_page_presentation' }] });
      return response(url.endsWith('/article-buttons') ? state.articles : state.home);
    }),
    post: vi.fn(async (url: string, { data }: { data: { settings?: HomeState['settings']; hero?: HomeState['hero'];
      presentation?: unknown; article_buttons?: HomeArticleSettings['article_buttons']; version?: string } }) => {
      events.push(`POST ${url}`);
      if (url.endsWith('/article-buttons')) {
        if (controls.failArticles) return response({}, 500);
        if (data.article_buttons && controls.ignoreRestore !== 'front_page_article_buttons') state.articles.article_buttons = structuredClone(data.article_buttons);
        state.articles.version = 'a2';
      } else if (url.includes('/api/delete-rows?')) {
        state.home.presentation = null; state.home.presentation_version = 'none';
      } else {
        for (const key of HOME_SWITCHES) if (data.settings && controls.ignoreRestore !== key) state.home.settings[key] = data.settings[key];
        // Like front_page_admin.go:79 and front_page_hero.go:89,109: a 32 KiB body limit, then Go's TrimSpace on
        // fi, en and usage_explanation (Unicode White_Space, not JavaScript's trim()).
        if (data.hero && Buffer.byteLength(JSON.stringify(data), 'utf8') > 32 << 10) return response({}, 400);
        if (data.hero && controls.ignoreRestore !== 'hero texts') state.home.hero = Object.fromEntries(Object.entries(data.hero)
          .map(([part, text]) => [part, { ...text, fi: goTrim(text.fi), en: goTrim(text.en), usage_explanation: goTrim(text.usage_explanation) }]));
        if ('presentation' in data && controls.failPresentation) return response({}, 409);
        if ('presentation' in data && controls.ignoreRestore !== 'front_page_presentation') {
          const stored = structuredClone(data.presentation) as { schema_version?: number;
            text_style?: { preset?: string; reveal?: { mode?: string } } } | null;
          // Match CanonicalStored: default/none is stored as v2 without text_style.
          if (stored?.text_style?.preset === 'default' && stored.text_style.reveal?.mode === 'none') {
            stored.schema_version = 2; delete stored.text_style;
          }
          state.home.presentation = stored; state.home.presentation_version = `p${++presentationRevision}`;
        }
      }
      if (controls.loseResponse) { controls.loseResponse = false; throw new Error('committed POST response lost'); }
      return response('presentation' in data ? { presentation: state.home.presentation, version: state.home.presentation_version } : {});
    }),
  } as unknown as APIRequestContext;
  const mutate = async () => {
    await request.post('/api/admin/front-page', { data: {
      settings: Object.fromEntries(HOME_SWITCHES.map(key => [key, !originalHome.settings[key]])),
      presentation: { alignment: 'right' }, hero: { ...originalHome.hero, title: { ...originalHome.hero.title, fi: 'Changed' } },
    } });
    await request.post('/api/admin/front-page/article-buttons', { data: { article_buttons: {
      schema_version: 1, placement: 'top_row', items: [{ table_uid: 3, row_id: '1', enabled: true }],
    } } });
  };
  return { request, state, controls, events, originalHome, originalArticles, mutate, origin };
}

function messages(error: unknown): string {
  return error instanceof AggregateError ? `${error.message} ${error.errors.map(messages).join(' ')}` : String(error);
}

// Owner's exact stored value on 18 October, including field order for JSON equality.
const SERIF_PRESENTATION_JSON = '{"anchor":"center-center","alignment":"left","dark_wash":0,"light_wash":73,"text_style":{"preset":"serif_story_v1","reveal":{"mode":"none","start_ms":3000,"interval_ms":800}},"dark_opacity":20,"max_width_px":1120,"light_opacity":75,"schema_version":3,"vertical_margin_px":40,"horizontal_margin_px":40}';

test.each(['pass', 'body failure', 'timeout backstop'] as const)(
  'T16 default pin restores the identical schema-3 Serif snapshot: %s', async path => {
    const original: Record<string, unknown> = JSON.parse(SERIF_PRESENTATION_JSON);
    const f = fixture(false, original);
    let saved!: HomeSettingsSnapshot;
    const pin = async (snapshot: HomeSettingsSnapshot) => {
      saved = snapshot;
      const response = await f.request.post('/api/admin/front-page', { data: {
        presentation: { ...snapshot.home.presentation as Record<string, unknown>,
          text_style: { preset: 'default', reveal: { mode: 'none', start_ms: 3000, interval_ms: 800 } } },
        version: snapshot.home.presentation_version,
      } });
      expect(response.ok()).toBe(true);
      const pinned: Record<string, unknown> = { ...original, schema_version: 2 };
      delete pinned.text_style;
      expect((await response.json()).presentation).toStrictEqual(pinned);
      expect(f.state.home.presentation).toStrictEqual(pinned);
      expect(f.state.home.presentation).not.toHaveProperty('text_style');
      expect((await (await f.request.get('/api/admin/front-page')).json()).presentation).toStrictEqual(pinned);
      expect(JSON.stringify(snapshot.home.presentation)).toBe(SERIF_PRESENTATION_JSON);
      vi.mocked(f.request.post).mockClear();
    };
    if (path === 'timeout backstop') {
      const snapshot = await trackedSnapshot(f.request);
      const restore = vi.spyOn(snapshot, 'restore');
      await pin(snapshot);
      expect(restore).not.toHaveBeenCalled(); // Body cleanup never ran.
      await runHomeTimeoutBackstop(f.request, snapshot);
      expect(restore).toHaveBeenCalledOnce();
    } else {
      const run = withHomeSettings(f.request, async snapshot => {
        await pin(snapshot);
        if (path === 'body failure') throw new Error('Serif body failed');
      });
      if (path === 'body failure') await expect(run).rejects.toThrow('Serif body failed');
      else await run;
    }
    expect(f.state.home.presentation).toStrictEqual(original);
    expect(JSON.stringify(f.state.home.presentation)).toBe(SERIF_PRESENTATION_JSON);
    expect(f.request.post).toHaveBeenCalledExactlyOnceWith('/api/admin/front-page', {
      headers: { 'X-CSRF-Token': 'fixture' }, data: { presentation: original, version: 'p2' },
    });
    // Later GETs returned v2: restoration must POST the captured original itself.
    expect(vi.mocked(f.request.post).mock.calls[0][1]?.data.presentation).toBe(saved.home.presentation);
  });

// Gate 253b: a hero value the trimming Home API cannot store back is refused before any write, and the lock is freed.
test.each([[' Owner title ', 'fi'], ['Owner title\n', 'en'], ['Note ', 'usage_explanation'],
  ['a\u0000b', 'fi'], ['é'.repeat(2001), 'en'], ['\ud800', 'fi']] as const)(
  'refuses an unrestorable hero value before any write: %j in title.%s', async (value, field) => {
    const f = fixture();
    f.state.home.hero.title = { ...f.state.home.hero.title, [field]: value };
    await expect(snapshotHomeSettings(f.request)).rejects.toThrow(`hero title.${field}`);
    expect(f.request.post).not.toHaveBeenCalled();
    expect(fs.existsSync(temporaryLockPaths.at(-1)!)).toBe(false);
  });

test('refuses a hero whose restore body would exceed the 32 KiB save limit, before any write', async () => {
  const f = fixture();
  for (const part of ['title', 'slogan', 'description']) {
    f.state.home.hero[part] = { ...f.state.home.hero[part], fi: '界'.repeat(2000), en: '界'.repeat(2000), usage_explanation: '' };
  }
  await expect(snapshotHomeSettings(f.request)).rejects.toThrow('hero payload (over 32 KiB)');
  expect(f.request.post).not.toHaveBeenCalled();
  expect(fs.existsSync(temporaryLockPaths.at(-1)!)).toBe(false);
});

test('the mock trims like Go: U+0085 is trimmed, U+FEFF is kept', () => {
  expect(goTrim('\u0085a\u0085')).toBe('a');
  expect(goTrim('﻿a')).toBe('﻿a');
});

test('a trimmed hero round trip stays exact, including inner line breaks', async () => {
  const f = fixture();
  f.state.home.hero.description = { ...f.state.home.hero.description, fi: '**Lead:**\nline two\n\nparagraph  two' };
  const original = structuredClone(f.state.home.hero);
  await withHomeSettings(f.request, async () => { await f.mutate(); });
  expect(f.state.home.hero).toStrictEqual(original);
});

test('snapshots six settings and hero texts before returning control, without a write', async () => {
  const f = fixture();
  const snapshot = await trackedSnapshot(f.request);
  expect(snapshot.home).toEqual(f.originalHome); expect(snapshot.articles).toEqual(f.originalArticles);
  expect(f.events).toEqual(['GET /api/admin/front-page', 'GET /api/admin/front-page', 'GET /api/admin/front-page/article-buttons']);
});

test('cleanup covers the first POST even when it commits and loses its response', async () => {
  const f = fixture(); f.controls.loseResponse = true;
  await expect(withHomeSettings(f.request, async () => { await f.mutate(); })).rejects.toThrow('committed POST response lost');
  expect(f.events.slice(0, 4)).toEqual(['GET /api/admin/front-page', 'GET /api/admin/front-page', 'GET /api/admin/front-page/article-buttons', 'POST /api/admin/front-page']);
  expect(f.state.home.settings).toEqual(f.originalHome.settings);
  expect(f.state.home.presentation).toEqual(f.originalHome.presentation);
  expect(f.events.slice(-2)).toEqual(['GET /api/admin/front-page', 'GET /api/admin/front-page/article-buttons']);
});

test('a failed body restores and reads back six settings and hero texts', async () => {
  const f = fixture();
  await expect(withHomeSettings(f.request, async () => { await f.mutate(); throw new Error('body failed'); })).rejects.toThrow('body failed');
  expect(f.state.home.settings).toEqual(f.originalHome.settings);
  expect(f.state.home.hero).toEqual(f.originalHome.hero);
  expect(f.state.home.presentation).toEqual(f.originalHome.presentation);
  expect(f.state.articles.article_buttons).toEqual(f.originalArticles.article_buttons);
});

test.each([...HOME_SWITCHES, 'front_page_article_buttons', 'front_page_presentation', 'hero texts'])(
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

test('hero restore writes only differences, sends every captured part/field and verifies readback', async () => {
  const f = fixture(); const snapshot = await trackedSnapshot(f.request);
  await snapshot.restoreHeroTexts();
  expect(f.request.post).not.toHaveBeenCalled();
  f.state.home.hero.description.usage_explanation = 'Changed note';
  f.events.length = 0;
  await snapshot.restoreHeroTexts();
  expect(f.request.post).toHaveBeenCalledExactlyOnceWith('/api/admin/front-page', {
    headers: { 'X-CSRF-Token': 'fixture' }, data: { hero: f.originalHome.hero },
  });
  expect(f.events).toEqual(['GET /api/admin/front-page', 'POST /api/admin/front-page', 'GET /api/admin/front-page']);
  expect(f.state.home.hero).toEqual(f.originalHome.hero);
});

test.each([false, true])('backstop re-saves present layouts with the latest revision; absence=%s', async absent => {
  const f = fixture(absent); const snapshot = await trackedSnapshot(f.request);
  f.state.home.presentation_version = absent ? 'none' : 'latest-from-body';
  await runHomeTimeoutBackstop(f.request, snapshot);
  expect(vi.mocked(f.request.post).mock.calls).toEqual(absent ? [] : [['/api/admin/front-page', {
    headers: { 'X-CSRF-Token': 'fixture' },
    data: { presentation: f.originalHome.presentation, version: 'latest-from-body' },
  }]]);
});

test('an originally absent layout is removed, never deliberately re-saved', async () => {
  const f = fixture(true); const snapshot = await trackedSnapshot(f.request);
  await f.mutate(); vi.mocked(f.request.post).mockClear();
  await runHomeTimeoutBackstop(f.request, snapshot);
  expect(vi.mocked(f.request.post).mock.calls.some(([, options]) => options?.data && Object.hasOwn(options.data, 'presentation'))).toBe(false);
  expect(f.state.home.presentation_version).toBe('none');
});

test('backstop orders hero, unconditional presentation and full restore/readback', async () => {
  const f = fixture(); const snapshot = await trackedSnapshot(f.request);
  const order: string[] = [];
  vi.spyOn(snapshot, 'restoreHeroTexts').mockImplementation(async () => { order.push('hero'); });
  vi.spyOn(snapshot, 'restore').mockImplementation(async () => { order.push('full restore/readback'); });
  vi.mocked(f.request.post).mockImplementationOnce(async () => {
    order.push('presentation'); return { ok: () => true } as Awaited<ReturnType<APIRequestContext['post']>>;
  });
  await runHomeTimeoutBackstop(f.request, snapshot);
  expect(order).toEqual(['hero', 'presentation', 'full restore/readback']);
});

test.each(['hero', 'presentation', 'full', 'all'])('backstop attempts every step and names failures: %s', async failing => {
  const f = fixture(); const snapshot = await trackedSnapshot(f.request);
  const hero = vi.spyOn(snapshot, 'restoreHeroTexts').mockImplementation(async () => {
    if (failing === 'hero' || failing === 'all') throw new Error('hero failed');
  });
  const restore = vi.spyOn(snapshot, 'restore').mockImplementation(async () => {
    if (failing === 'full' || failing === 'all') throw new Error('full failed');
  });
  f.controls.failPresentation = failing === 'presentation' || failing === 'all';
  let failure: unknown;
  try { await runHomeTimeoutBackstop(f.request, snapshot); } catch (error) { failure = error; }
  expect(hero).toHaveBeenCalledOnce(); expect(restore).toHaveBeenCalledOnce(); expect(f.request.post).toHaveBeenCalledOnce();
  expect(failure).toBeInstanceOf(AggregateError);
  for (const [step, label] of [['hero', 'hero restore'], ['presentation', 'presentation re-save'], ['full', 'full restore/readback']]) {
    if (failing === step || failing === 'all') expect(messages(failure)).toContain(label);
  }
});

test.each([false, true])('one hook takes/clears its snapshot even on failure, with a separate budget; failure=%s', async failing => {
  const f = fixture(); const snapshot = await trackedSnapshot(f.request);
  let hook!: (fixtures: object, info: TestInfo) => Promise<void>;
  const register = vi.fn((callback: typeof hook) => { hook = callback; });
  const arm = homeTimeoutBackstop({ afterEach: register });
  const info = { setTimeout: vi.fn() } as unknown as TestInfo;
  const restore = vi.spyOn(snapshot, 'restore');
  if (failing) restore.mockRejectedValue(new Error('full cleanup failed'));
  f.events.length = 0;
  await hook({}, info);
  expect(f.events).toEqual([]); expect(info.setTimeout).not.toHaveBeenCalled();
  arm(f.request, snapshot);
  if (failing) await expect(hook({}, info)).rejects.toThrow('Home timeout backstop failed');
  else await hook({}, info);
  expect(register).toHaveBeenCalledOnce(); expect(restore).toHaveBeenCalledOnce();
  expect(info.setTimeout).toHaveBeenCalledWith(60_000);
  f.events.length = 0;
  await hook({}, info);
  expect(f.events).toEqual([]); expect(restore).toHaveBeenCalledOnce();
});

test('second pass after clean body changes no values, only the presentation revision', async () => {
  const f = fixture(); const snapshot = await trackedSnapshot(f.request);
  await f.mutate(); await snapshot.restore();
  const clean = structuredClone(f.state); vi.mocked(f.request.post).mockClear();
  await runHomeTimeoutBackstop(f.request, snapshot);
  expect(f.state.home.presentation_version).not.toBe(clean.home.presentation_version);
  expect(f.state.home).toEqual({ ...clean.home, presentation_version: f.state.home.presentation_version });
  expect(f.state.articles).toEqual(clean.articles);
  expect(vi.mocked(f.request.post).mock.calls).toEqual([['/api/admin/front-page', {
    headers: { 'X-CSRF-Token': 'fixture' },
    data: { presentation: f.originalHome.presentation, version: clean.home.presentation_version },
  }]]);
});

function writerIsHeld(origin: string) {
  const foreign = createHomeWriterLock({ pid: process.ppid, isAlive: () => true });
  let lease: ReturnType<typeof foreign> | undefined;
  try { lease = foreign(origin); return false; }
  catch (error) {
    if (!String(error).includes('Another real-writing Home spec')) throw error;
    return true;
  } finally { lease?.release(); }
}

function timeoutHook() {
  let hook!: (fixtures: object, info: TestInfo) => Promise<void>;
  const arm = homeTimeoutBackstop({ afterEach: callback => { hook = callback; } });
  return { arm, run: (info = { setTimeout: vi.fn() } as unknown as TestInfo) => hook({}, info) };
}

test('a foreign live lock rejects the snapshot before JSON, further requests or any write', async () => {
  const f = fixture();
  const lease = createHomeWriterLock({ pid: process.ppid })(f.origin, 'T16 other worker');
  const json = vi.fn();
  vi.mocked(f.request.get).mockResolvedValueOnce({ url: () => `${f.origin}/api/admin/front-page`, json } as unknown as Awaited<ReturnType<APIRequestContext['get']>>);
  try {
    await expect(snapshotHomeSettings(f.request, 'T17')).rejects.toThrow('T16 other worker');
    expect(f.request.get).toHaveBeenCalledTimes(1); // Origin discovery only, never a snapshot read.
    expect(json).not.toHaveBeenCalled(); expect(f.request.post).not.toHaveBeenCalled();
    expect(fs.existsSync(lease.path)).toBe(true);
  } finally { lease.release(); }
});

test('the origin-discovery payload is discarded; snapshot values are fetched under the lock', async () => {
  const f = fixture(); const json = vi.fn(async () => { throw new Error('unlocked values'); });
  vi.mocked(f.request.get).mockResolvedValueOnce({ ok: () => true, url: () => `${f.origin}/redirected-home`, json } as unknown as Awaited<ReturnType<APIRequestContext['get']>>);
  const saved = await trackedSnapshot(f.request);
  expect(json).not.toHaveBeenCalled(); expect(saved.home).toEqual(f.originalHome);
  expect(writerIsHeld(f.origin)).toBe(true);
});

test.each(['discovery', 'json', 'switches', 'articles', 'configuration'])(
  'snapshot failure releases the writer: %s', async failing => {
    const f = fixture();
    if (failing === 'discovery') vi.mocked(f.request.get).mockRejectedValueOnce(new Error('GET failed'));
    if (failing === 'json') {
      const response = await f.request.get('/api/admin/front-page');
      vi.mocked(f.request.get).mockResolvedValueOnce(response).mockResolvedValueOnce({ ...response,
        json: async () => { throw new Error('invalid JSON'); } });
    }
    if (failing === 'switches') delete f.state.home.settings.front_page_show_blocks;
    if (failing === 'articles') {
      const get = vi.mocked(f.request.get).getMockImplementation()!;
      vi.mocked(f.request.get).mockImplementation(async (url, options) => {
        if (url.endsWith('/article-buttons')) throw new Error('article GET failed');
        return get(url, options);
      });
    }
    if (failing === 'configuration') f.state.articles.configuration_error = 'invalid';
    await expect(snapshotHomeSettings(f.request)).rejects.toThrow();
    expect(f.request.post).not.toHaveBeenCalled(); expect(writerIsHeld(f.origin)).toBe(false);
  });

test.each(['pass', 'body', 'restore', 'readback'])(
  'without a backstop the last body cleanup releases even on %s', async outcome => {
    const f = fixture(); vi.spyOn(console, 'error').mockImplementation(() => {});
    const run = withHomeSettings(f.request, async () => {
      expect(writerIsHeld(f.origin)).toBe(true);
      await f.mutate();
      if (outcome === 'restore') f.controls.failArticles = true;
      if (outcome === 'readback') f.controls.ignoreRestore = 'hero texts';
      if (outcome === 'body') throw new Error('failed body');
    });
    if (outcome === 'pass') await run;
    else await expect(run).rejects.toThrow();
    expect(writerIsHeld(f.origin)).toBe(false);
  });

test.each(['pass', 'hero', 'presentation', 'restore', 'readback', 'hook budget'])(
  'backstop keeps ownership after body restore, then finally releases: %s', async outcome => {
    const f = fixture(), backstop = timeoutHook();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await withHomeSettings(f.request, async saved => {
      snapshots.push(saved);
      backstop.arm(f.request, saved);
      await f.mutate();
      const restore = saved.restore;
      vi.spyOn(saved, 'restore').mockImplementation(async () => {
        expect(writerIsHeld(f.origin)).toBe(true);
        await restore();
        if (outcome === 'restore') throw new Error('restore failed');
      });
      // Install hook-only failures after the body's own cleanup below.
      if (outcome === 'restore') vi.mocked(saved.restore).mockImplementationOnce(restore);
      if (outcome === 'hero') vi.spyOn(saved, 'restoreHeroTexts').mockRejectedValue(new Error('hero failed'));
    });
    expect(writerIsHeld(f.origin)).toBe(true);
    if (outcome === 'presentation') f.controls.failPresentation = true;
    if (outcome === 'readback') { f.state.home.hero.title.fi = 'changed'; f.controls.ignoreRestore = 'hero texts'; }
    const info = { setTimeout: vi.fn(() => { if (outcome === 'hook budget') throw new Error('budget failed'); }) } as unknown as TestInfo;
    if (outcome === 'pass') await backstop.run(info);
    else await expect(backstop.run(info)).rejects.toThrow('Home timeout backstop failed');
    expect(writerIsHeld(f.origin)).toBe(false);
  });

test('independent beforeAll and repeated snapshots stay owned through the last afterAll cleanup', async () => {
  const f = fixture(), backstop = timeoutHook();
  const independent = await trackedSnapshot(f.request);
  try {
    await withHomeSettings(f.request, async saved => { backstop.arm(f.request, saved); await f.mutate(); });
    const repeated = await trackedSnapshot(f.request);
    backstop.arm(f.request, repeated);
    await backstop.run();
    expect(writerIsHeld(f.origin)).toBe(true);
    try { await independent.verify(); }
    finally { independent.releaseWriter(); }
    expect(writerIsHeld(f.origin)).toBe(false);
  } finally { independent.releaseWriter(); }
});

test('a release error cannot hide the original body failure', async () => {
  const f = fixture();
  let failure: unknown;
  try {
    await withHomeSettings(f.request, async saved => {
      const release = saved.releaseWriter;
      vi.spyOn(saved, 'releaseWriter').mockImplementation(() => { release(); throw new Error('release failed'); });
      throw new Error('body failed');
    });
  } catch (error) { failure = error; }
  expect(messages(failure)).toContain('body failed');
  expect(messages(failure)).toContain('release failed');
  expect(writerIsHeld(f.origin)).toBe(false);
});
