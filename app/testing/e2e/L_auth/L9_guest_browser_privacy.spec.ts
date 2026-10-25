// L9_guest_browser_privacy.spec.ts
// Proves guest browsing has no browser bindings and signed-in replay detection survives.
// Uses owned API datasets/media, fresh sign-ins and response-only Home/fence policy.
// Never changes login_to_browse or reads credentials outside loadCredentials().
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { login, loadCredentials, logout, readSessionInfo } from '../helpers/auth';
import { buildTempDatasetName, createTempDataset, dropTempDataset, openTempDatasetRowArticle,
  fetchCsrfTokenForRequest } from '../helpers/temp-dataset';
import { configureArticleFieldRoles, postJsonWithCsrf } from '../helpers/image-first-article';
import { waitForAppReady } from '../helpers/navigation';

type AccessRow = { id: number } & Record<string, unknown>;
const bindingName = /^(device_id|fingerprint)(?:_|$)/;
const checkPath = '/api/check-fingerprint';
const frontPagePath = /\/api\/front-page(?:\?.*)?$/;

async function noGuestBindings(context: BrowserContext) {
  expect((await context.cookies()).filter(cookie => bindingName.test(cookie.name))).toEqual([]);
  expect((await context.cookies()).some(cookie => /^session(?:_|$)/.test(cookie.name))).toBe(true);
}

// Response fixtures affect only this browser. The native APIs, root and storage
// still serve real guest requests; the second test changes only the shell's fence policy.
async function homePolicy(context: BrowserContext, fenced = false) {
  await context.route('**/api/auth-modes', async route => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({ response, json: { ...data, separate_front_page: true,
      display_index_html_at_startup: false, ...(fenced ? { login_required_for_browse: true } : {}) } });
  });
  await context.route(frontPagePath, route => route.fulfill({ json: {
    site_name: 'Guest privacy Home', hero: { title: { en: 'Guest privacy Home', fi: 'Vieraan etusivu' } },
    blocks: [], show_blocks: false, viewer_id: 1,
  } }));
}

async function accessRows(page: Page, dataset: string, fields: Record<string, string | number>): Promise<AccessRow[]> {
  const query = new URLSearchParams({ dataset, view_key: 'table' });
  for (const [column, value] of Object.entries(fields)) {
    query.set(`${column}_from`, String(value)); query.set(`${column}_to`, String(value));
  }
  const response = await page.request.get(`/api/get-results?${query}`);
  expect(response.ok(), await response.text()).toBe(true);
  const { data } = await response.json();
  expect(Array.isArray(data)).toBe(true);
  for (const row of data) expect(row).toMatchObject(fields);
  return data;
}

// Only add a missing Page view grant, as C17 does for guest article views.
// Arm cleanup before insertion, re-read its exact identity, and preserve all prior rows.
async function guestPageGrant(owner: Page, run: () => Promise<void>) {
  const groups = await accessRows(owner, 'system_user_groups', { name: 'guests' });
  expect(groups).toHaveLength(1);
  const functions = await accessRows(owner, 'system_functions', { name: 'ui.view.image_first_page_view' });
  expect(functions).toHaveLength(1);
  expect(functions[0]).toMatchObject({ disabled: false, specific_table_related: false });
  const fields = { user_group_id: groups[0].id, function_id: functions[0].id };
  const dataset = 'system_group_table_func_rights';
  const before = await accessRows(owner, dataset, fields);
  const exists = before.some(row => row.target_schema_name === 'public' && row.target_table_uid === null);
  let attempted = false;
  try {
    if (!exists) {
      attempted = true;
      const added = await owner.request.post(`/api/add-row-multipart?dataset=${dataset}`, {
        headers: { 'X-CSRF-Token': await fetchCsrfTokenForRequest(owner.request) },
        multipart: { jsonPayload: JSON.stringify({ ...fields, target_schema_name: 'public', target_table_uid: null }) },
      });
      expect(added.status(), await added.text()).toBe(201);
    }
    await run();
  } finally {
    if (attempted) {
      const current = await accessRows(owner, dataset, fields);
      const added = current.filter(row => !before.some(original => original.id === row.id));
      expect(added.length).toBeLessThanOrEqual(1);
      for (const row of added) {
        expect(row).toMatchObject({ ...fields, target_schema_name: 'public', target_table_uid: null });
        const removed = await postJsonWithCsrf(owner, `/api/delete-rows?dataset=${dataset}`, { ids: [row.id] });
        expect(removed.ok, removed.body).toBe(true);
      }
      expect(await accessRows(owner, dataset, fields)).toEqual(before);
    }
  }
}

test.describe('L9 — Guest browser privacy', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('Home, dataset, media and Page stay unbound; sign-in, replay refusal and sign-out still work', async ({ page, browser }, info) => {
    test.skip(info.project.name !== 'desktop-card',
      'Run the owned media/grant/replay proof once; the fenced guest shell runs in every project.');
    test.setTimeout(180_000);
    const modes = await page.request.get('/api/auth-modes');
    expect(modes.ok()).toBe(true);
    expect((await modes.json()).login_required_for_browse,
      'This real public-browsing proof needs a guest-enabled native target; it never changes owner policy.').toBe(false);
    await homePolicy(page.context());
    const checks: string[] = [];
    page.on('request', request => { if (new URL(request.url()).pathname === checkPath) checks.push(request.method()); });
    const owner = await browser.newContext({ baseURL: info.project.use.baseURL, ignoreHTTPSErrors: true,
      extraHTTPHeaders: info.project.use.extraHTTPHeaders, storageState: { cookies: [], origins: [] } });
    const ownerPage = await owner.newPage();
    const dataset = buildTempDatasetName('e2e_wo91_privacy');
    let created = false;
    try {
      await login(ownerPage, loadCredentials());
      await createTempDataset(ownerPage, { datasetName: dataset, grantGuestsRead: true,
        columns: { id: 'SERIAL', title: 'TEXT', description: 'TEXT', detail_note: 'TEXT' },
        seedRows: [{ title: 'Guest privacy article', description: 'Guest content remains readable', detail_note: 'Page detail' }] });
      created = true;
      await configureArticleFieldRoles(ownerPage, dataset);
      const enabled = await postJsonWithCsrf(ownerPage, '/api/asset-linking/images/enable', { parent_table: dataset, max_file_size_mb: 1 });
      expect(enabled.status, enabled.body).toBe(201);
      await openTempDatasetRowArticle(ownerPage, dataset, 1);
      // A tiny synthetic PNG, never a local or owner-owned media file.
      await ownerPage.locator('.big_card_image_gallery input[type="file"]').first().setInputFiles({
        name: 'guest-privacy.png', mimeType: 'image/png',
        buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAACCAIAAAAW4yFwAAAADklEQVR4nGNwaFjAAMQACkgCwU0jaEgAAAAASUVORK5CYII=', 'base64'),
      });
      const thumbnail = ownerPage.locator('[data-testid^="big-card-image-thumb-"]').first();
      await expect(thumbnail).toBeVisible();
      // The test ID is on the wrapper; the nested image carries the storage URL.
      const thumbnailImage = thumbnail.locator('img').first();
      await expect(thumbnailImage).toHaveAttribute('src', /\/storage\//, { timeout: 15_000 });
      const storageURL = await thumbnailImage.getAttribute('src');
      expect(storageURL).toMatch(/\/storage\//);
      const datasetPath = new URL(ownerPage.url()).pathname.replace(/\/1(?:-[^/]*)?\/?$/, '');
      await guestPageGrant(ownerPage, async () => {
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await expect(page.locator('#front_page_container')).toHaveAttribute('aria-busy', 'false');
        await noGuestBindings(page.context());
        // Retire old cookie-only guest bindings on a real root navigation too.
        const session = (await page.context().cookies()).find(cookie => /^session(?:_|$)/.test(cookie.name))!;
        const suffix = session.name.slice('session'.length);
        await page.context().addCookies(['device_id', 'fingerprint'].map(prefix => ({
          name: `${prefix}${suffix}`, value: 'obsolete-guest-binding', url: new URL(page.url()).origin,
          httpOnly: true, secure: true, sameSite: 'Lax' as const,
        })));
        await page.goto(`${datasetPath}?view=card`, { waitUntil: 'domcontentloaded' });
        await expect(page.locator(`#${dataset}_card_view_container`)).toContainText('Guest privacy article');
        await noGuestBindings(page.context());
        const media = await page.goto(new URL(storageURL!, info.project.use.baseURL).href);
        expect(media?.status()).toBe(200);
        expect(media?.headers()['content-type']).toMatch(/^image\//);
        await noGuestBindings(page.context());
        await page.goto(`${datasetPath}/1?view=image_first_page_view`, { waitUntil: 'domcontentloaded' });
        await expect(page.locator('.image_first_page_view')).toContainText('Guest privacy article');
        await noGuestBindings(page.context());
        expect(checks, 'Guest boot must not call the fingerprint endpoint').toEqual([]);
      });

      // The fixed guest Home response must not claim a signed-in viewer is guest.
      await page.context().unroute('**/api/auth-modes');
      await page.context().unroute(frontPagePath);
      await login(page, loadCredentials());
      const signedCheck = page.waitForResponse(response => new URL(response.url()).pathname === checkPath);
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      expect((await signedCheck).status()).toBe(200);
      await waitForAppReady(page);
      const cookies = await page.context().cookies();
      const bindings = cookies.filter(cookie => bindingName.test(cookie.name));
      expect(bindings).toHaveLength(2);
      for (const cookie of bindings) { expect(cookie.httpOnly).toBe(true); expect(cookie.expires).toBeGreaterThan(Date.now() / 1000); }
      const userAgent = await page.evaluate(() => navigator.userAgent);
      const replay = await browser.newContext({ baseURL: info.project.use.baseURL, ignoreHTTPSErrors: true,
        extraHTTPHeaders: info.project.use.extraHTTPHeaders, storageState: { cookies, origins: [] },
        userAgent: userAgent.includes('Firefox')
          ? 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36'
          : 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0' });
      try {
        const stolen = await replay.newPage();
        let refusalBody: unknown;
        await stolen.route(url => url.pathname === checkPath, async route => {
          const response = await route.fetch();
          // Capture the real body before delivery lets auth handling navigate away.
          refusalBody = await response.json();
          await route.fulfill({ response });
        });
        const refusal = stolen.waitForResponse(response => new URL(response.url()).pathname === checkPath);
        await stolen.goto('/', { waitUntil: 'domcontentloaded' });
        const response = await refusal;
        expect(response.status()).toBe(403);
        expect(refusalBody).toMatchObject({ auth_failure: true });
        await expect(stolen.getByTestId('login-form')).toBeVisible();
        const guestModes = await replay.request.get('/api/auth-modes');
        expect((await guestModes.json()).needs_button).toBe('login');
      } finally { await replay.close(); }
      const signedChecks = checks.length;
      await logout(page);
      expect((await readSessionInfo(page)).user_id ?? 0).toBeLessThanOrEqual(1);
      await noGuestBindings(page.context());
      expect(checks.length, 'Signed-out bootstrap must not restart fingerprint checks').toBe(signedChecks);
    } finally {
      try { if (created) await dropTempDataset(ownerPage, dataset); }
      finally { await owner.close(); }
    }
  });

  test('the fenced guest authentication shell retains CSRF and sign-in without bindings or a check', async ({ page }) => {
    await homePolicy(page.context(), true);
    const checks: string[] = [];
    page.on('request', request => { if (new URL(request.url()).pathname === checkPath) checks.push(request.url()); });
    // Authentication entry is the real public root exception on a fenced site.
    // Only auth-modes' response is fenced; no settings POST reaches the owner.
    await page.goto('/?login-entry=1&redirect=%2Fapp_service_catalog', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('login-form')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('login_required_for_browse'))).toBe('true');
    const csrf = await page.request.get('/api/csrf-token');
    expect(csrf.ok()).toBe(true);
    const first = (await csrf.json()).csrf_token;
    expect(typeof first).toBe('string'); expect(first.length).toBeGreaterThan(0);
    const again = await page.request.get('/api/csrf-token');
    expect((await again.json()).csrf_token).toBe(first);
    await noGuestBindings(page.context());
    expect(checks).toEqual([]);
  });
});
