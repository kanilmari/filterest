// G12_top_nav_home_button.spec.ts
// Proves Home in dataset headers, exact menu destination and unchanged menu memory.
// Capture WO37_PROBE_PHASE=before on the old checkout, then after on this checkout.
// Screenshots: runtime root/wo37/{before,after}; run card projects with --workers=1.
// Captures/restores all four Home switches as T17 does, with independent teardown.
import { test as base, expect, type APIRequestContext, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import * as path from 'node:path';
import { login, loadCredentials } from '../helpers/auth';
import { fetchCsrfTokenForRequest } from '../helpers/temp-dataset';
import { waitForAppReady } from '../helpers/navigation';
import { resolveFilterestTestRuntimeRoot } from '../helpers/test-runtime-paths';
import { expandAdminTreeFolder, openAdminTreeButton } from '../helpers/admin-navigation';
import { ensureNavbarVisible } from '../helpers/navbar';

const phase = process.env.WO37_PROBE_PHASE || 'after';
if (!['before', 'after'].includes(phase)) throw new Error('WO37_PROBE_PHASE must be before or after');
const outputRoot = path.join(resolveFilterestTestRuntimeRoot(), 'wo37', phase);
const homeURL = '/api/admin/front-page';
type Settings = { separate_front_page: boolean; front_page_button_shows_site_name: boolean;
  front_page_show_blocks: boolean; display_index_html_at_startup: boolean };

async function readSettings(request: APIRequestContext): Promise<Settings> {
  const response = await request.get(homeURL);
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()).settings;
}
async function saveSettings(request: APIRequestContext, settings: Settings) {
  const response = await request.post(homeURL, {
    headers: { 'X-CSRF-Token': await fetchCsrfTokenForRequest(request) }, data: { settings },
  });
  expect(response.ok(), await response.text()).toBe(true);
  expect(await readSettings(request)).toEqual(settings);
}

const test = base.extend<{ homeBaseline: Settings }>({
  homeBaseline: [async ({ page, playwright }, use) => {
    await login(page, loadCredentials());
    const original = await readSettings(page.request);
    // A separate request context survives test/page timeouts. Fixture teardown has
    // its own budget and restores even if an enable request fails after writing.
    const cleanup = await playwright.request.newContext({ storageState: await page.context().storageState(),
      ignoreHTTPSErrors: true, baseURL: new URL(page.url()).origin,
      extraHTTPHeaders: { 'X-Bypass-Ratelimit': 'test-mode' } });
    try { await use(original); }
    finally {
      try { await saveSettings(cleanup, original); }
      finally { await cleanup.dispose(); }
    }
  }, { timeout: 60_000 }],
});
test.describe.configure({ mode: 'serial' });

async function menuState(page: Page) {
  return page.evaluate(() => ({
    classes: document.getElementById('navbar')!.className,
    narrow: localStorage.getItem('navVisibleNarrow'), wide: localStorage.getItem('navVisibleWide'),
  }));
}

async function openDataset(page: Page, view: string, menuOpen: boolean) {
  await page.addInitScript(open => {
    localStorage.setItem('navVisibleNarrow', String(open));
    localStorage.setItem('navVisibleWide', String(open));
  }, menuOpen);
  await page.goto(`/app_service_catalog?view=${view}`, { waitUntil: 'domcontentloaded' });
  await waitForAppReady(page);
  await expect(page.locator('#app_service_catalog_tab_parts_container')).toBeVisible();
  await expect(page.locator('#navbar')).toHaveClass(menuOpen ? /^(?!.*collapsed)/ : /collapsed/);
  // Let the navbar's existing entrance finish before comparing its whole class list.
  await expect(page.locator('#navbar')).not.toHaveClass(/navbar-opening/);
}

for (const width of [1440, 1000, 375]) for (const theme of ['light', 'dark'] as const) {
  test(`Home on/off at ${width}px in ${theme}`, async ({ page, homeBaseline }, testInfo) => {
    // Twenty-four dataset visits, twelve Home returns, writes and screenshots.
    // Teardown restores separately even if this body reaches its overall budget.
    test.setTimeout(150_000);
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light' });
    // Use the real theme owner with an explicit response-only preference; no
    // account appearance writes need compensation and OS preference is opposite.
    await page.route('**/api/user-visual-preference', async route => {
      expect(route.request().method()).toBe('GET');
      await route.fulfill({ json: { configured: true, revision: 1, theme_mode: theme } });
    });
    await mkdir(outputRoot, { recursive: true });
    const shot = async (state: string) => page.screenshot({ path: path.join(outputRoot,
      `${testInfo.project.name}-${width}-${theme}-${state}.png`) });
    for (const enabled of [true, false]) {
      await saveSettings(page.request, { ...homeBaseline, separate_front_page: enabled,
        display_index_html_at_startup: false, front_page_button_shows_site_name: false });
      for (const view of ['card', 'table', 'article_view', 'image_first_view', 'normal', 'transposed']) {
        for (const menuOpen of [false, true]) {
          await openDataset(page, view, menuOpen);
          await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}-mode\\b`));
          const home = page.getByTestId('top-nav-home-button').filter({ visible: true });
          await shot(`${enabled ? 'on' : 'off'}-${view}-${menuOpen ? 'menu-open' : 'menu-closed'}`);
          if (phase === 'before') continue; // Baseline capture must also work without the new control.
          await expect(home).toHaveCount(enabled ? 1 : 0);
          if (!enabled) continue;
          const menuLink = page.locator('#navbarFrontPage a');
          await expect(menuLink).toHaveCount(1);
          expect(await home.getAttribute('href')).toBe(await menuLink.getAttribute('href'));
          await expect(home).toHaveAccessibleName(/\S/);
          await expect(home.locator('[data-symbol-key="home"]')).toHaveCount(1);
          const bounds = (await home.boundingBox())!;
          expect(bounds.x).toBeGreaterThanOrEqual(0);
          expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
          expect(bounds.height).toBeGreaterThanOrEqual(44);
          const before = await menuState(page);
          if (menuOpen) await home.click();
          else {
            // Tab must reach the link naturally; Enter uses its shared click handler.
            await page.evaluate(() => {
              // Clicking the bottom of Table view selects a cell. blur() leaves
              // Chromium's sequential starting point there, beyond the header,
              // with hundreds of cells before wraparound. Start at the document.
              const previous = document.body.getAttribute('tabindex');
              document.body.tabIndex = -1;
              document.body.focus({ preventScroll: true });
              if (previous === null) document.body.removeAttribute('tabindex');
              else document.body.setAttribute('tabindex', previous);
            });
            for (let tab = 0; tab < 100 && !await home.evaluate(el => el === document.activeElement); tab++) {
              await page.keyboard.press('Tab');
            }
            await expect(home).toBeFocused();
            await expect(home).toHaveCSS('outline-style', 'solid');
            await home.press('Enter');
          }
          await expect(page).toHaveURL(/\/$/);
          await expect(page.locator('#front_page_container')).toHaveAttribute('aria-busy', 'false');
          expect(await menuState(page)).toEqual(before);
          await expect(page.getByTestId('top-nav-home-button').filter({ visible: true })).toHaveCount(1);
          await expect(page.getByTestId('top-nav-home-button').filter({ visible: true }))
            .toHaveAttribute('aria-current', 'page');
        }
      }
    }
  });
}

for (const width of [1440, 1000, 375]) for (const theme of ['light', 'dark'] as const) {
  test(`Home settings update the cached dataset without reload at ${width}px in ${theme}`,
    async ({ page, homeBaseline }) => {
      test.skip(phase === 'before', 'Round-two live-settings regression requires the new Home control.');
      test.setTimeout(90_000);
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light' });
      await page.route('**/api/user-visual-preference', async route => {
        expect(route.request().method()).toBe('GET');
        await route.fulfill({ json: { configured: true, revision: 1, theme_mode: theme } });
      });
      await saveSettings(page.request, { ...homeBaseline, separate_front_page: false,
        display_index_html_at_startup: false, front_page_button_shows_site_name: false });
      await openDataset(page, 'card', false);
      const documentStart = await page.evaluate(() => performance.timeOrigin);
      const cached = await page.locator('#app_service_catalog_tab_parts_container').elementHandle();
      await expect(page.getByTestId('top-nav-home-button').filter({ visible: true })).toHaveCount(0);
      try {
        // The real editor saves and refreshes auth policy; neither settings
        // navigation nor returning through the dataset tab reloads the document.
        for (const enabled of [true, false, true]) {
          await ensureNavbarVisible(page);
          await expandAdminTreeFolder(page, 'site_settings');
          await openAdminTreeButton(page, 'front_page_settings');
          const editor = page.locator('#front_page_settings_container .front-page-settings-view');
          // As in T18, wait for a real editable control, not a retained shell's
          // stale aria-busy state, before closing the menu over the left column.
          await expect(editor.getByTestId('front-page-enabled')).toBeEnabled();
          await expect(editor).toHaveAttribute('aria-busy', 'false');
          if (!/\bcollapsed\b/.test(await page.locator('#navbar').getAttribute('class') || '')) {
            await page.locator('#hideMenuButton').click();
          }
          await expect(page.locator('#navbar')).toHaveClass(/(?:^|\s)collapsed(?:\s|$)/);
          await expect(editor.getByTestId('front-page-enabled')).toBeVisible();
          await editor.getByTestId('front-page-enabled').setChecked(enabled);
          await editor.getByTestId('front-page-settings-save').click();
          await expect(editor).toHaveAttribute('aria-busy', 'false');
          expect((await readSettings(page.request)).separate_front_page).toBe(enabled);
          // Reconcile the inactive cached header at settings refresh, too.
          await expect(page.locator('#app_service_catalog_container .top-nav-home-button'))
            .toHaveCount(enabled ? 1 : 0);
          await ensureNavbarVisible(page);
          await page.getByTestId('tab-app_service_catalog').evaluate((button: HTMLElement) => button.click());
          await expect(page.locator('#app_service_catalog_container')).toBeVisible();
          await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}-mode\\b`));
          await expect(page.getByTestId('top-nav-home-button').filter({ visible: true }))
            .toHaveCount(enabled ? 1 : 0);
          expect(await cached!.evaluate(element =>
            element === document.getElementById('app_service_catalog_tab_parts_container'))).toBe(true);
          expect(await page.evaluate(() => performance.timeOrigin)).toBe(documentStart);
        }
      } finally { await cached?.dispose(); }
    });
}
