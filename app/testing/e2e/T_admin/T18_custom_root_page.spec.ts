// T18_custom_root_page.spec.ts
// Proves K378 root delivery, access boundaries, Home/history and missing-file fallback.
// Connects the manual native config, supported administrator APIs and owned operator files.
// Restores original switches/theme; the global teardown removes the fixture even when assertions fail.
import { expect, test, type APIRequestContext, type APIResponse, type BrowserContext, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as https from 'node:https';
import { fetchCsrfTokenForRequest } from '../helpers/test-artifact-csrf-reader';
import { expandAdminTreeFolder, openAdminTreeButton } from '../helpers/admin-navigation';
import { ensureNavbarVisible } from '../helpers/navbar';
import { writeOwnerOnlyJsonFile } from '../helpers/storage-state-file';

const fixture = process.env.FILTEREST_E2E_CUSTOM_ROOT_FIXTURE;
if (!fixture || !path.isAbsolute(fixture)) throw new Error('K378 requires FILTEREST_E2E_CUSTOM_ROOT_FIXTURE.');
const helper = path.join(__dirname, 'T18_custom_root_fixture.sh');
const SWITCH = 'display_index_html_at_startup';
const HOME_SWITCHES = [SWITCH, 'separate_front_page', 'front_page_button_shows_site_name', 'front_page_show_blocks'];
const MARKER = 'K378 external script loaded';
const ASSETS = ['custom_root.css', 'custom_root.js', 'custom_root.svg'];
const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; media-src 'self'; connect-src 'none'; worker-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const VALUE_COLUMNS = ['boolean_value', 'text_value', 'json_value', 'value_type'] as const;
type ConfigRow = { id: number; key: string; boolean_value: boolean | null; text_value: string | null;
  json_value: string | null; value_type: number | null };
type Theme = { theme_mode: string; configured: boolean };
type HomeState = { settings: Record<string, boolean>; site_root: { path: string; exists: boolean; ready: boolean; status_error: boolean } };
let adminContext: BrowserContext;
let admin: APIRequestContext;
let originalHome: HomeState | undefined;
let originalSwitch: ConfigRow | null | undefined;
const originalHomeRows: Record<string, ConfigRow | null> = {};
let originalBrowse: ConfigRow | undefined;
let originalTheme: Theme | undefined;
let switchTouched = false, browseTouched = false, themeTouched = false;

function files(action: string) {
  execFileSync('bash', [helper, action, fixture!], { stdio: 'pipe' });
}

async function json<T>(response: APIResponse): Promise<T> {
  expect(response.ok(), `API refused with HTTP ${response.status()}`).toBe(true);
  expect(response.headers()['content-type']).toContain('application/json');
  return response.json() as Promise<T>;
}

async function row(key: string): Promise<ConfigRow | null> {
  const query = new URLSearchParams({ dataset: 'system_config', view_key: 'table', key_from: key, key_to: key });
  const result = await json<{ data: ConfigRow[] }>(await admin.get(`/api/get-results?${query}`));
  expect(Array.isArray(result.data)).toBe(true);
  expect(result.data.length).toBeLessThanOrEqual(1);
  if (result.data.length) expect(result.data[0].key).toBe(key);
  if (!result.data.length) return null;
  const value = result.data[0];
  // Missing columns would make restoration incomplete; fail before changing anything.
  for (const column of VALUE_COLUMNS) expect(Object.hasOwn(value, column), `${key}.${column} missing`).toBe(true);
  // The results API returns JSONB as raw JSON text, preserving SQL NULL versus JSON null.
  expect(value.json_value === null || typeof value.json_value === 'string', `${key}.json_value format`).toBe(true);
  const { id, key: name, boolean_value, text_value, json_value, value_type } = value;
  return { id, key: name, boolean_value, text_value, json_value, value_type };
}

async function restoreRow(key: string, original: ConfigRow | null) {
  if (original === null) {
    const introduced = await row(key);
    if (introduced) await write('/api/delete-rows?dataset=system_config', { ids: [introduced.id] });
    expect(await row(key)).toBeNull();
    return;
  }
  // The existing update API accepts an atomic multi-column write, including explicit NULLs.
  // Reuse the raw JSON text from get-results; stringifying it would store a JSON string instead.
  await write('/api/update-row?dataset=system_config', { id: original.id,
    updates: VALUE_COLUMNS.map(column => ({ column, value: original[column] })) });
  expect(await row(key)).toEqual(original);
}

async function write(url: string, data: unknown, method: 'POST' | 'PATCH' | 'DELETE' = 'POST') {
  const response = await admin.fetch(url, {
    method, headers: { 'X-CSRF-Token': await fetchCsrfTokenForRequest(admin) }, data,
  });
  expect(response.ok(), `Setting write refused with HTTP ${response.status()}`).toBe(true);
}

async function setRoot(enabled: boolean) {
  switchTouched = true; // Set before sending: a lost response may still have saved the setting.
  await write('/api/admin/front-page', { settings: rootSettings(enabled) });
  expect((await home()).settings[SWITCH]).toBe(enabled);
}

function rootSettings(enabled: boolean) {
  // The Home API requires both existing presentation switches, even for a root-only change.
  return { separate_front_page: originalHome!.settings.separate_front_page,
    front_page_button_shows_site_name: originalHome!.settings.front_page_button_shows_site_name,
    [SWITCH]: enabled };
}

async function setBrowse(enabled: boolean) {
  browseTouched = true;
  await write('/api/update-row?dataset=system_config', { id: originalBrowse!.id, column: 'boolean_value', value: enabled });
  expect(await row('login_to_browse')).toMatchObject({ id: originalBrowse!.id, boolean_value: enabled });
}

async function setTheme(theme: 'light' | 'dark') {
  themeTouched = true;
  await write('/api/user-visual-preference', { theme_mode: theme }, 'PATCH');
  expect(await json<Theme>(await admin.get('/api/user-visual-preference'))).toMatchObject({ theme_mode: theme, configured: true });
}

async function home() { return json<HomeState>(await admin.get('/api/admin/front-page')); }

async function assertCustom(page: Page) {
  await expect(page.getByTestId('custom-root-fixture')).toBeVisible();
  await expect(page.getByTestId('custom-root-script-marker')).toHaveText(MARKER);
  await expect(page.getByTestId('custom-root-script-marker')).toBeVisible();
  await expect(page.locator('#tabs_container')).toHaveCount(0);
}

async function assertShell(page: Page) {
  await expect(page.locator('#tabs_container')).toBeVisible();
  await expect(page.getByTestId('custom-root-fixture')).toHaveCount(0);
}

function assertHeaders(response: APIResponse) {
  const headers = response.headers();
  expect(headers['content-security-policy']).toBe(CSP);
  expect(headers['cache-control']).toBe('private, no-store');
  expect(headers.vary.split(/,\s*/)).toContain('Cookie');
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['referrer-policy']).toBe('no-referrer');
  expect(headers.etag).toBeUndefined();
  expect(headers['last-modified']).toBeUndefined();
}

async function settings(page: Page) {
  await page.goto('/system_config', { waitUntil: 'domcontentloaded' });
  await assertShell(page);
  await ensureNavbarVisible(page);
  await expandAdminTreeFolder(page, 'site_settings');
  await openAdminTreeButton(page, 'front_page_settings');
  await expect(page.getByTestId('front-page-custom-root-enabled')).toBeEnabled();
  // At this config's 1440 px viewport the open menu covers the settings' left column where the checkboxes sit
  // (native run 14.10. 11:30: clicks landed on menu items). Close it with its own button, as an administrator would.
  await page.locator('#hideMenuButton').click();
  await expect(page.locator('#navbar')).toHaveClass(/(?:^|\s)collapsed(?:\s|$)/);
}

// One worker, default (non-serial) mode: a failed assertion does not skip later proofs.
test.beforeAll(async ({ browser, baseURL }, info) => {
  files('verify');
  adminContext = await browser.newContext({
    baseURL, storageState: info.project.use.storageState,
    ignoreHTTPSErrors: true, extraHTTPHeaders: { 'X-Bypass-Ratelimit': 'test-mode' },
  });
  admin = adminContext.request;
  // Snapshot every value column and original absence before any mutation.
  originalHome = await home();
  for (const key of HOME_SWITCHES) originalHomeRows[key] = await row(key);
  originalSwitch = originalHomeRows[SWITCH];
  originalBrowse = (await row('login_to_browse')) ?? undefined;
  expect(typeof originalHome.settings[SWITCH]).toBe('boolean');
  expect(typeof originalBrowse?.boolean_value).toBe('boolean');
  // The reported path may run through a symlinked storage root (the native dev instance has storage ->
  // data/runtime-data/storage) while the helper needs the canonical folder: compare the files' canonical paths.
  expect(fs.realpathSync(originalHome.site_root.path)).toBe(fs.realpathSync(path.join(fixture!, 'index.html')));
  expect(originalHome.site_root).toMatchObject({ exists: true, ready: true, status_error: false });
  const theme = await json<Theme>(await admin.get('/api/user-visual-preference'));
  originalTheme = { theme_mode: theme.theme_mode, configured: theme.configured };
  const recovery = info.outputPath('original-k378-settings.json');
  writeOwnerOnlyJsonFile(recovery, { switch: originalSwitch, home_settings: originalHomeRows,
    login_to_browse: originalBrowse, theme: originalTheme });
  await info.attach('original-k378-settings', { path: recovery, contentType: 'application/json' });
});

test.beforeEach(async ({ page }) => {
  files('verify');
  await setTheme('light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await setBrowse(true);
  await setRoot(true);
});

test.afterAll(async () => {
  const failures: unknown[] = [];
  const attempt = async (step: () => unknown | Promise<unknown>) => {
    try { await step(); } catch (error) { failures.push(error); }
  };
  // Home saves overwrite boolean/text/JSON/type together. Restore the complete original rows or absence.
  for (const key of HOME_SWITCHES) await attempt(async () => {
    if (!switchTouched) return;
    await restoreRow(key, originalHomeRows[key]);
  });
  await attempt(async () => { if (switchTouched) expect((await home()).settings).toEqual(originalHome!.settings); });
  await attempt(async () => {
    if (!browseTouched) return;
    await restoreRow('login_to_browse', originalBrowse!);
  });
  await attempt(async () => {
    if (!themeTouched) return;
    await write('/api/user-visual-preference', originalTheme!.configured ? { theme_mode: originalTheme!.theme_mode } : undefined,
      originalTheme!.configured ? 'PATCH' : 'DELETE');
    expect(await json<Theme>(await admin.get('/api/user-visual-preference'))).toMatchObject(originalTheme!);
  });
  // No fixture removal here: Playwright replaces the worker after a failed test and runs afterAll on the way out, so
  // removing it here would break every later proof. custom_root_setup's returned cleanup (the global teardown)
  // removes it once, after the last worker, even when assertions fail.
  await attempt(() => adminContext?.close());
  if (failures.length) throw new AggregateError(failures, 'K378 restoration/fixture cleanup failed.');
});

test('disabled switch retains the root shell and refuses fixture assets', async ({ page }) => {
  await setRoot(false);
  const response = await page.goto('/', { waitUntil: 'domcontentloaded' });
  expect(response?.status()).toBe(200);
  await assertShell(page);
  for (const asset of ASSETS) expect((await page.request.get(`/.site_root/${asset}`)).status()).toBe(404);
});

test('signed-in root serves the document, CSS, external script, image and HEAD with dedicated policy', async ({ page }) => {
  const loadedAssets: string[] = [];
  page.on('response', response => {
    if (new URL(response.url()).pathname.startsWith('/.site_root/') && response.ok()) loadedAssets.push(new URL(response.url()).pathname);
  });
  const response = await page.goto('/', { waitUntil: 'load' });
  expect(response?.status()).toBe(200);
  await assertCustom(page);
  await expect(page.getByTestId('custom-root-fixture')).toHaveCSS('border-top-width', '3px');
  expect(await page.getByTestId('custom-root-image').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth === 48)).toBe(true);
  expect(loadedAssets.sort()).toEqual(ASSETS.map(asset => `/.site_root/${asset}`).sort());
  const types = ['text/html; charset=utf-8', 'text/css; charset=utf-8', 'text/javascript; charset=utf-8', 'image/svg+xml'];
  for (const [index, url] of ['/', ...ASSETS.map(asset => `/.site_root/${asset}`)].entries()) {
    const get = await page.request.get(url);
    expect(get.status()).toBe(200); assertHeaders(get);
    expect(get.headers()['content-type']).toBe(types[index]);
    const head = await page.request.head(url);
    expect(head.status()).toBe(200); assertHeaders(head);
    expect(head.headers()['content-type']).toBe(types[index]);
    expect(head.headers()['content-length']).toBe(String((await get.body()).length));
    expect((await head.body()).length).toBe(0);
  }
});

test('signed-out and retained-guest visitors cannot read private root/files, including queries and HEAD', async ({ browser, baseURL }) => {
  const visitor = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] }, ignoreHTTPSErrors: true,
    extraHTTPHeaders: { 'X-Bypass-Ratelimit': 'test-mode' } });
  try {
    // First acquire an actual guest cookie; keep it when the login requirement is turned on.
    await setBrowse(false);
    const guestPage = await visitor.newPage();
    await guestPage.goto('/', { waitUntil: 'load' });
    await assertCustom(guestPage);
    expect(await json<{ needs_button: string }>(await visitor.request.get('/api/auth-modes'))).toMatchObject({ needs_button: 'login' });
    expect((await visitor.cookies()).length).toBeGreaterThan(0);
    await setBrowse(true);
    for (const retainedGuest of [true, false]) {
      if (!retainedGuest) await visitor.clearCookies();
      for (const query of ['', '?k378=query', '?login-entry=1']) {
        for (const url of ['/', ...ASSETS.map(asset => `/.site_root/${asset}`)]) {
          // Explicit login entries intentionally serve the shell; asset queries never get that bypass.
          if (url === '/' && query === '?login-entry=1') continue;
          for (const method of ['GET', 'HEAD']) {
            const denied = await visitor.request.fetch(url + query, { method, maxRedirects: 0 });
            expect([302, 303]).toContain(denied.status());
            expect(new URL(denied.headers().location, baseURL).pathname).toBe('/login');
            const body = await denied.text();
            expect(body).not.toContain('custom-root-fixture');
            expect(body).not.toContain(MARKER);
          }
        }
      }
      const response = await guestPage.goto('/', { waitUntil: 'domcontentloaded' });
      expect(response?.status()).toBe(200);
      await expect(guestPage.getByTestId('login-form')).toBeVisible();
      await expect(guestPage.getByTestId('custom-root-fixture')).toHaveCount(0);
      expect((await guestPage.goto('/?login-entry=1', { waitUntil: 'domcontentloaded' }))?.status()).toBe(200);
      await expect(guestPage.getByTestId('login-form')).toBeVisible();
      await expect(guestPage.getByTestId('custom-root-fixture')).toHaveCount(0);
    }
  } finally { await visitor.close(); }
});

test('public browsing delivers the custom page and assets to a fresh signed-out visitor', async ({ browser, baseURL }) => {
  await setBrowse(false);
  const visitor = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] }, ignoreHTTPSErrors: true,
    extraHTTPHeaders: { 'X-Bypass-Ratelimit': 'test-mode' } });
  try {
    const page = await visitor.newPage();
    expect((await page.goto('/?k378=public', { waitUntil: 'load' }))?.status()).toBe(200);
    await assertCustom(page);
    for (const asset of ASSETS) {
      const response = await visitor.request.get(`/.site_root/${asset}?k378=public`);
      expect(response.status()).toBe(200); assertHeaders(response);
    }
  } finally { await visitor.close(); }
});

test('raw traversal, escaped separators and existing unknown types are refused', async ({ page, baseURL }) => {
  await page.goto('/', { waitUntil: 'load' });
  const cookie = (await page.context().cookies()).map(value => `${value.name}=${value.value}`).join('; ');
  const raw = (target: string, method: string) => new Promise<{ status: number; location?: string; body: string }>((resolve, reject) => {
    // Node's raw path preserves dot segments; URL/fetch clients normalize them before sending.
    const origin = new URL(baseURL!);
    const request = https.request({ hostname: origin.hostname, port: origin.port, path: target, method,
      rejectUnauthorized: false, headers: { Cookie: cookie, 'X-Bypass-Ratelimit': 'test-mode' } }, response => {
      const chunks: Buffer[] = [];
      response.on('data', chunk => chunks.push(Buffer.from(chunk)));
      response.on('end', () => resolve({ status: response.statusCode!, location: response.headers.location,
        body: Buffer.concat(chunks).toString() }));
    });
    request.on('error', reject); request.end();
  });
  // Go's ServeMux cleans literal dot segments before any application handler runs: it answers 307 with the cleaned
  // path (Go 1.26), so these requests never reach the site_root handler. The cleaned paths outside the asset prefix
  // must not expose the folder's files; the in-prefix one is the ordinary asset path for the same file.
  const dotSegments: Record<string, string> = { '/.site_root/../k378-secret.json': '/k378-secret.json',
    '/.site_root/styles/../index.html': '/.site_root/index.html', '/.site_root/../site_root/index.html': '/site_root/index.html' };
  for (const [target, cleaned] of Object.entries(dotSegments)) {
    for (const method of ['GET', 'HEAD']) {
      const received = await raw(target, method);
      expect(received.status, `${method} ${target}`).toBe(307);
      expect(received.location, `${method} ${target}`).toBe(cleaned);
      expect(received.body).not.toContain('K378_REFUSED_BYTES');
      expect(received.body).not.toContain('custom-root-fixture');
    }
  }
  for (const outside of ['/k378-secret.json', '/site_root/index.html', '/site_root/k378-secret.json']) {
    const received = await raw(outside, 'GET');
    expect(received.body, `GET ${outside}`).not.toContain('K378_REFUSED_BYTES');
    expect(received.body, `GET ${outside}`).not.toContain('custom-root-fixture');
  }
  for (const target of ['/.site_root%2fcustom_root.css', '/.site_root%2Fcustom_root.css',
    '/.site_root/custom_root%2ecss', '/.site_root%5ccustom_root.css', '/.site_root%252fcustom_root.css',
    '/.site_root/styles%2fcustom_root.css', '/.site_root/styles%2Fcustom_root.css',
    '/.site_root/styles%5ccustom_root.css', '/.site_root/styles%252fcustom_root.css',
    '/.site_root/%2e%2e/index.html', '/.site_root/%2e%2e/k378-secret.json', '/.site_root/k378-secret.json']) {
    for (const method of ['GET', 'HEAD']) {
      const received = await raw(target, method);
      expect(received.status, `${method} ${target}`).toBe(404);
      expect(received.body).not.toContain('K378_REFUSED_BYTES');
      expect(received.body).not.toContain('custom-root-fixture');
    }
  }
});

test('dataset Home performs one document load without SPA Home flash; Back/Forward remain usable', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });
  await assertCustom(page);
  await page.getByTestId('custom-root-dataset').click();
  await expect(page).toHaveURL(/\/system_config(?:\?|$)/);
  await assertShell(page);
  await expect(page.locator('#system_config_tab_parts_container')).toBeVisible();
  await expect(page.locator('body')).toHaveClass(/light-mode/);
  // Observe the outgoing document synchronously, retaining evidence across document replacement.
  await page.evaluate(() => {
    sessionStorage.setItem('k378-home-flash', 'false');
    const detect = () => {
      if (Array.from(document.querySelectorAll('#front_page_container, .front-page')).some(element => {
        const bounds = element.getBoundingClientRect();
        return getComputedStyle(element).visibility !== 'hidden' && bounds.width > 0 && bounds.height > 0;
      })) sessionStorage.setItem('k378-home-flash', 'true');
    };
    new MutationObserver(detect).observe(document.documentElement, { childList: true, subtree: true, attributes: true });
    window.addEventListener('pagehide', detect);
    detect();
  });
  await ensureNavbarVisible(page);
  const homeControl = page.locator('#navbarFrontPage a[href="/"]');
  await expect(homeControl).toBeVisible();
  await expect(homeControl).toHaveAttribute('aria-label', /\S/);
  const documents: string[] = [];
  const record = (request: import('@playwright/test').Request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents.push(new URL(request.url()).pathname);
  };
  page.on('request', record);
  await homeControl.click();
  await assertCustom(page);
  await page.waitForLoadState('load');
  expect(documents).toEqual(['/']);
  expect(await page.evaluate(() => sessionStorage.getItem('k378-home-flash'))).toBe('false');
  page.off('request', record);
  await page.goBack(); await assertShell(page);
  await expect(page).toHaveURL(/\/system_config(?:\?|$)/);
  await page.goForward(); await assertCustom(page);
  await page.goBack(); await assertShell(page);
  await ensureNavbarVisible(page);
  await page.locator('#navbarFrontPage a[href="/"]').click();
  await assertCustom(page); // Back into a cached SPA must reset the Home departure latch.
  await page.getByTestId('custom-root-home').click();
  await assertCustom(page);
});

test('a slow accepted Home departure suppresses separate clicks until its root response arrives', async ({ page }) => {
  await page.goto('/system_config', { waitUntil: 'load' });
  await assertShell(page);
  await expect(page.locator('#system_config_tab_parts_container')).toBeVisible();
  await ensureNavbarVisible(page);
  const homeControl = page.locator('#navbarFrontPage a[href="/"]');
  await expect(homeControl).toBeVisible();
  const bounds = await homeControl.boundingBox();
  expect(bounds).not.toBeNull();
  const clickHome = () => page.mouse.click(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
  // While '/' is held, Chromium answers no evaluation at all (locator queries wait for the navigation; CDP
  // Runtime.evaluate and page.evaluate return nothing until it settles — native probe 14.10. 15:53), but the
  // outgoing document keeps running and its console messages arrive. It reports its own state: delivered DOM clicks,
  // whether the Home link still has a box and how many SPA Home containers are visible.
  const reports: string[] = [];
  const onConsole = (message: import('@playwright/test').ConsoleMessage) => {
    if (message.text().startsWith('K378 state ')) reports.push(message.text());
  };
  page.on('console', onConsole);
  await homeControl.evaluate(link => {
    const report = () => {
      const box = link.getBoundingClientRect();
      const home = [...document.querySelectorAll('#front_page_container, .front-page')]
        .filter(node => node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden').length;
      console.log(`K378 state clicks=${link.dataset.k378Clicks} link=${box.width > 0 && box.height > 0} home=${home}`);
    };
    link.dataset.k378Clicks = '0';
    link.addEventListener('click', () => { link.dataset.k378Clicks = String(Number(link.dataset.k378Clicks) + 1); report(); });
    window.setInterval(report, 200);
  });
  const documents: string[] = [];
  const record = (request: import('@playwright/test').Request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents.push(new URL(request.url()).pathname);
  };
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const root = (url: URL) => url.pathname === '/' && !url.search;
  let intercepted = 0;
  await page.route(root, async route => {
    intercepted++;
    await held;
    if (!page.isClosed()) await route.continue().catch(error => { if (!page.isClosed()) throw error; });
  });
  page.on('request', record);
  try {
    // Mouse clicks do not wait for a navigation to finish, unlike locator.click().
    await clickHome();
    await expect.poll(() => documents).toEqual(['/']);
    await page.waitForTimeout(25); // Reproduce the gate's separate-click interval while '/' is deliberately held.
    await clickHome();
    await page.waitForTimeout(1100); // Cross the removed one-second recovery timer while the load is still accepted.
    await clickHome();
    // The physical clicks must reach the outgoing document even while '/' is held.
    await expect.poll(() => reports.some(report => report.startsWith('K378 state clicks=3 '))).toBe(true);
    const afterThird = reports.length;
    // Two more interval reports from the still-held outgoing document: the link remains, no SPA Home appeared.
    await expect.poll(() => reports.length).toBeGreaterThanOrEqual(afterThird + 2);
    for (const report of reports.slice(afterThird)) expect(report).toBe('K378 state clicks=3 link=true home=0');
    expect(documents).toEqual(['/']);
    expect(intercepted).toBe(1);
    release();
    await assertCustom(page);
    await page.waitForLoadState('load');
    expect(documents).toEqual(['/']);
    expect(intercepted).toBe(1);
  } finally {
    release();
    page.off('request', record);
    page.off('console', onConsole);
    if (!page.isClosed()) await page.unroute(root).catch(error => { if (!page.isClosed()) throw error; });
  }
});

test('cancelling a requested native leave prompt allows Home after saving', async ({ page }) => {
  await page.goto('/system_config', { waitUntil: 'load' });
  await assertShell(page);
  await expect(page.locator('#system_config_tab_parts_container')).toBeVisible();
  await ensureNavbarVisible(page);
  const homeControl = page.locator('#navbarFrontPage a[href="/"]');
  await expect(homeControl).toBeVisible();
  await page.evaluate(() => {
    // A document-local dirty draft requests a real browser prompt. Saving clears it.
    const dirty = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', dirty);
    document.addEventListener('k378-save-draft', () => window.removeEventListener('beforeunload', dirty), { once: true });
  });
  const dialog = page.waitForEvent('dialog');
  const clicked = homeControl.click({ noWaitAfter: true });
  const prompt = await dialog;
  expect(prompt.type()).toBe('beforeunload');
  await prompt.dismiss();
  await clicked;
  await assertShell(page);
  await page.evaluate(() => document.dispatchEvent(new Event('k378-save-draft')));
  await homeControl.click();
  await assertCustom(page);
});

test('a 204 keeps early Home retries suppressed and allows a deliberate retry after 10 seconds', async ({ page }) => {
  await page.goto('/system_config', { waitUntil: 'load' });
  await assertShell(page);
  await expect(page.locator('#system_config_tab_parts_container')).toBeVisible();
  await ensureNavbarVisible(page);
  const homeControl = page.locator('#navbarFrontPage a[href="/"]');
  await expect(homeControl).toBeVisible();
  const documents: string[] = [];
  const record = (request: import('@playwright/test').Request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents.push(new URL(request.url()).pathname);
  };
  const root = (url: URL) => url.pathname === '/' && !url.search;
  // Chromium drops this navigation without any page-visible terminal signal.
  await page.route(root, route => route.fulfill({ status: 204, body: '' }), { times: 1 });
  page.on('request', record);
  try {
    const response = page.waitForResponse(response => new URL(response.url()).pathname === '/' && response.status() === 204);
    await homeControl.click({ noWaitAfter: true });
    // Headers alone do not mean that Chromium has finished dropping the navigation, but Chromium 148 reports neither
    // requestfinished nor requestfailed for the dropped 204 (native run 14.10. 15:35: finished() never settled within
    // the test timeout), so it gets a bounded moment instead.
    const dropped = await response;
    await Promise.race([dropped.finished(), page.waitForTimeout(1000)]);
    await assertShell(page);
    await expect(page).toHaveURL(/\/system_config(?:\?|$)/);
    await homeControl.click();
    await assertShell(page); // Early pointer retry must remain suppressed.
    await expect(page).toHaveURL(/\/system_config(?:\?|$)/);
    // Real elapsed time starts after the first attempt ended; stays within 30 s.
    // No timer may release the latch or issue a document request by itself.
    await page.waitForTimeout(10000);
    expect(documents).toEqual(['/']);
    await homeControl.press('Enter'); // A NEW keyboard activation can now retry.
    await assertCustom(page);
    await page.waitForLoadState('load');
    expect(documents).toEqual(['/', '/']);
  } finally {
    page.off('request', record);
    if (!page.isClosed()) await page.unroute(root).catch(error => { if (!page.isClosed()) throw error; });
  }
});

test('enabled switch with removed index falls back without repeated document loads and reports missing', async ({ page }) => {
  files('hide');
  try {
    expect((await home()).site_root).toMatchObject({ exists: false, ready: false, status_error: false });
    const documents: string[] = [];
    page.on('request', request => {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents.push(new URL(request.url()).pathname);
    });
    expect((await page.goto('/', { waitUntil: 'load' }))?.status()).toBe(200);
    await assertShell(page);
    expect(await json<{ display_index_html_at_startup: boolean }>(await page.request.get('/api/auth-modes')))
      .toMatchObject({ display_index_html_at_startup: false });
    await page.waitForFunction(() => {
      const shell = (window as Window & { __filterestShellBoot?: { status: () => { ready: boolean } } }).__filterestShellBoot;
      return shell ? shell.status().ready : !document.body.classList.contains('loading');
    });
    // Two animation frames plus shell readiness expose startup reload loops without a fixed sleep.
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    expect(documents).toEqual(['/']);
    expect((await page.request.get('/.site_root/custom_root.css')).status()).toBe(404);
    await settings(page);
    await expect(page.getByTestId('front-page-custom-root-enabled')).toBeChecked();
    await expect(page.getByTestId('front-page-custom-root-status')).toContainText(/missing|puuttuu|缺少|搵唔到/);
  } finally { files('show'); }
});

for (const theme of ['light', 'dark'] as const) {
  test(`administrator switch saves both ways and shows ready file status in ${theme} theme`, async ({ page }) => {
    await setTheme(theme);
    await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light' });
    await settings(page);
    await expect(page.locator('body')).toHaveClass(new RegExp(`${theme}-mode`));
    const toggle = page.getByTestId('front-page-custom-root-enabled');
    const status = page.getByTestId('front-page-custom-root-status');
    await expect(toggle).toBeChecked();
    await expect(status).toBeVisible();
    await expect(status).toContainText(/ready to serve|valmis näytettäväksi|可以显示|可以顯示/);
    await expect(status.locator('code')).toHaveText(originalHome!.site_root.path);
    for (const enabled of [false, true]) {
      await toggle.setChecked(enabled);
      const saved = page.waitForResponse(response => new URL(response.url()).pathname === '/api/admin/front-page' && response.request().method() === 'POST');
      await page.getByTestId('front-page-settings-save').click();
      expect((await saved).ok()).toBe(true);
      expect((await home()).settings[SWITCH]).toBe(enabled);
      await page.getByTestId('front-page-reload').click();
      await expect(toggle).toBeChecked({ checked: enabled });
    }
  });
}
