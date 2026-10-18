// T22_home_timeout_backstop.spec.ts
// Proves completed real Home writes are restored after a deliberate body timeout.
// Uses an independent administrator snapshot/readback and the shared pre-teardown hook.
// An expected timeout keeps the same worker for the second test's independent proof.
import { expect, test, type APIRequestContext, type TestInfo } from '@playwright/test';
import { fetchCsrfTokenForRequest } from '../helpers/test-artifact-csrf-reader';
import { HOME_SWITCHES, homeTimeoutBackstop, snapshotHomeSettings, type HomeSettingsSnapshot, type HomeState } from '../helpers/home-settings';

test.describe.configure({ mode: 'serial', retries: 0 });
const armHomeBackstop = homeTimeoutBackstop(test);
let admin: APIRequestContext | undefined;
let original: HomeSettingsSnapshot | undefined;
let bodyInfo: TestInfo | undefined;
let reachedHang = false;

async function home(request: APIRequestContext): Promise<HomeState> {
  const response = await request.get('/api/admin/front-page');
  expect(response.ok()).toBe(true);
  return response.json();
}

async function write(request: APIRequestContext, data: unknown) {
  const response = await request.post('/api/admin/front-page', {
    headers: { 'X-CSRF-Token': await fetchCsrfTokenForRequest(request) }, data,
  });
  expect(response.ok(), `T22 completed write: HTTP ${response.status()}`).toBe(true);
  await response.json();
}

test.beforeAll(async ({ playwright, baseURL }, info) => {
  admin = await playwright.request.newContext({ baseURL, storageState: info.project.use.storageState,
    ignoreHTTPSErrors: true, extraHTTPHeaders: { 'X-Bypass-Ratelimit': 'test-mode' } });
  original = await snapshotHomeSettings(admin, `${info.title || info.file} (beforeAll)`);
});

// Playwright 1.60 sources below are relative to node_modules/playwright/:
// types/test.d.ts:2498 makes expectedStatus writable, including "timedOut".
// lib/worker/workerProcessEntry.js:2554-2556 compares actual and expected status;
// :3073 does not force afterAll early, and :3085-3086 does not stop the worker.
// lib/runner/index.js:5293-5297 copies the expectation from the test-end payload;
// :585-594 gives outcome "expected", and :5430-5449 skips only serial failures.
// Set the expectation only at the completed-write hang: earlier failures/timeouts
// stay unexpected and skip test 2; ignoring the assignment also leaves a red test.
test.afterAll(async ({}, info) => {
  try {
    info.setTimeout(60_000);
    const failures: unknown[] = [];
    const attempt = async (action: () => Promise<void>) => {
      try { await action(); } catch (error) { failures.push(error); }
    };
    // Recovery only: retain the mismatch as a failure even if restoration succeeds.
    // restore() writes differences only and ends with a full independent readback.
    if (original) {
      try { await original.verify(); }
      catch (error) {
        failures.push(error);
        await attempt(original.restore);
      }
    }
    await attempt(async () => { await admin?.dispose(); });
    if (failures.length) throw new AggregateError(failures, 'T22 recovery verification, restoration or disposal failed');
  } finally { original?.releaseWriter(); }
});

test('completed switch, hero and presentation writes are restored after timeout', async ({ request }, info) => {
  // 20 s for a handful of local API writes/readbacks, followed by the deliberate
  // hang. Shared afterEach gets its own 60 s slot; afterAll also gets 60 s.
  test.setTimeout(20_000);
  bodyInfo = info;
  const snapshot = await snapshotHomeSettings(request, info.title);
  armHomeBackstop(request, snapshot);
  const before = snapshot.home;
  const settings = Object.fromEntries(HOME_SWITCHES.map(key => [key, before.settings[key]]));
  settings.front_page_button_shows_site_name = !before.settings.front_page_button_shows_site_name;
  await write(request, { settings });
  expect((await home(request)).settings.front_page_button_shows_site_name).toBe(settings.front_page_button_shows_site_name);

  const title = before.hero.title.fi === 'T22 timeout proof' ? 'T22 changed title' : 'T22 timeout proof';
  const hero = { ...before.hero, title: { ...before.hero.title, fi: title } };
  await write(request, { hero });
  expect((await home(request)).hero).toEqual(hero);
  expect(title).not.toBe(before.hero.title.fi);

  // Reproduce T16's default pin for a non-default text style (including Serif).
  // Otherwise toggle alignment; an introduced layout is removed through CRUD.
  const layout = (before.presentation ?? { schema_version: 2, anchor: 'center-center', alignment: 'left',
    horizontal_margin_px: 40, vertical_margin_px: 40, max_width_px: 1120,
    light_wash: 15, light_opacity: 75, dark_wash: 0, dark_opacity: 20 }) as Record<string, unknown>;
  const textStyle = layout.text_style as { preset?: string; reveal?: { mode?: string } } | undefined;
  const pinDefaultStyle = !!textStyle && (textStyle.preset !== 'default' || textStyle.reveal?.mode !== 'none');
  const defaultStyle = { preset: 'default', reveal: { mode: 'none', start_ms: 3000, interval_ms: 800 } };
  const presentation: Record<string, unknown> = pinDefaultStyle ? { ...layout, text_style: defaultStyle }
    : { ...layout, alignment: layout.alignment === 'right' ? 'left' : 'right' };
  const latest = await home(request);
  await write(request, { presentation, version: latest.presentation_version });
  const changed = await home(request);
  if (pinDefaultStyle) {
    expect(changed.presentation).toMatchObject({ text_style: defaultStyle });
    // Admin GET/POST normalize v2 to v3. Read the stored JSON through supported
    // CRUD, as T18 does, to prove the pin really dropped text_style before hanging.
    const query = new URLSearchParams({ dataset: 'system_config', view_key: 'table',
      key_from: 'front_page_presentation', key_to: 'front_page_presentation' });
    const response = await request.get(`/api/get-results?${query}`);
    expect(response.ok()).toBe(true);
    const rows = await response.json() as { data: Array<{ key: string; json_value: string }> };
    expect(rows.data).toHaveLength(1);
    expect(rows.data[0].key).toBe('front_page_presentation');
    expect(typeof rows.data[0].json_value).toBe('string');
    const stored = JSON.parse(rows.data[0].json_value) as Record<string, unknown>;
    expect(stored.schema_version).toBe(2);
    expect(stored).not.toHaveProperty('text_style');
  } else expect(changed.presentation).toMatchObject({ alignment: presentation.alignment });
  expect(changed.presentation).not.toEqual(before.presentation);
  expect(changed.presentation_version).not.toBe(before.presentation_version);
  reachedHang = true;
  info.expectedStatus = 'timedOut';
  await new Promise<void>(() => {}); // Intentional timeout; every request above has completed.
});

test('independent snapshot proves every Home value was restored in the same worker', async () => {
  expect(reachedHang, 'All three writes and changed-value readbacks completed before the hang').toBe(true);
  expect(bodyInfo).toBeDefined();
  expect(bodyInfo!.status, 'The proof must reach a real Playwright timeout').toBe('timedOut');
  expect(test.info().workerIndex, 'The timeout backstop ran in the same worker').toBe(bodyInfo!.workerIndex);
  // workerProcessEntry.js:2512-2520 retains timedOut when cleanup also fails.
  // Only the intentional timeout is expected; extra hook/fixture errors stay red.
  expect(bodyInfo!.errors, 'The intentional body timeout must be the only error').toHaveLength(1);
  expect(original).toBeDefined();
  await original!.verify(); // Four switches, presentation/absence, buttons and every hero part/field.
  const restored = (await home(admin!)).presentation as Record<string, unknown> | null;
  const before = original!.home.presentation as Record<string, unknown> | null;
  expect(restored?.schema_version).toBe(before?.schema_version);
  expect(restored?.text_style).toEqual(before?.text_style);
  // Retain the supervisor's marker text; the proof now runs in this second test.
  console.log('[T22] independent afterAll readback: six Home settings and hero texts restored after timeout');
});
