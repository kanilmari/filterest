// home-policy-fixture.ts
// Simulates Home policy and content through browser responses, never server writes.
// Shared by WO37 layout and historical phone measurements on any native test target.
// Browser context teardown discards routes and local menu/theme preferences.
import { expect, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { waitForAppReady } from './navigation';
import { closeActiveFilterbarIfOpen } from './filterbar';

export type HomePolicy = { enabled: boolean; label: string; failure: number };
export const probePhase = process.env.WO37_PROBE_PHASE || 'after';
if (!['before', 'after'].includes(probePhase)) throw new Error('WO37_PROBE_PHASE must be before or after');

export async function installHomePolicy(context: BrowserContext, theme: 'light' | 'dark' = 'light', homeContent: Record<string, unknown> = {}) {
  const policy: HomePolicy = { enabled: true, label: '', failure: 0 };
  await context.route('**/api/auth-modes', async route => {
    expect(route.request().method()).toBe('GET');
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...await response.json(), separate_front_page: policy.enabled,
      display_index_html_at_startup: false, front_page_button_site_name: policy.label } });
  });
  await context.route(/\/api\/admin\/front-page(?:\?.*)?$/,  async route => {
    if (route.request().method() === 'POST') {
      // Exercise the real save path while keeping all four switches in this fixture.
      const settings = route.request().postDataJSON().settings;
      if (!settings) throw new Error('WO37 fixture only accepts simulated settings saves');
      policy.enabled = settings.separate_front_page === true;
      await route.fulfill({ json: { version: '' } });
    } else {
      expect(route.request().method()).toBe('GET');
      const response = await route.fetch();
      const data = await response.json();
      await route.fulfill({ response, json: { ...data, settings: { ...data.settings,
        separate_front_page: policy.enabled, display_index_html_at_startup: false,
        front_page_button_shows_site_name: false } } });
    }
  });
  await context.route(/\/api\/front-page(?:\?.*)?$/,  async route => {
    expect(route.request().method()).toBe('GET');
    if (!policy.enabled || policy.failure) {
      await route.fulfill({ status: policy.failure || 404,
        json: { error: policy.failure ? 'test failure' : 'front page unavailable', code: policy.failure || 404 } });
      return;
    }
    const profile = await context.request.get(new URL('/api/user-profile', route.request().url()).href);
    expect(profile.ok()).toBe(true);
    const viewer = (await profile.json()).user_id;
    expect(Number.isInteger(viewer) && viewer > 1).toBe(true);
    await route.fulfill({ json: { site_name: 'WO37', blocks: [], show_blocks: false,
      hero: { title: { fi: 'Etusivu', en: 'Home' } }, ...homeContent, viewer_id: viewer } });
  });
  await context.route('**/api/user-visual-preference', async route => {
    expect(route.request().method()).toBe('GET');
    await route.fulfill({ json: { configured: true, revision: 1, theme_mode: theme } });
  });
  return policy;
}

// assertMenu=false: a second tab in the same context shares localStorage menu preferences with the first, so its
// initial menu state can follow the other tab; such callers open the menu explicitly (ensureNavbarVisible).
export async function openHomeProbeDataset(page: Page, menuOpen: boolean, view = 'card', assertMenu = true) {
  await page.addInitScript(open => {
    localStorage.setItem('navVisibleNarrow', String(open));
    localStorage.setItem('navVisibleWide', String(open));
  }, menuOpen);
  await page.goto(`/app_service_catalog?view=${view}`, { waitUntil: 'domcontentloaded' });
  await waitForAppReady(page);
  await expect(page.locator('#app_service_catalog_tab_parts_container')).toBeVisible();
  await closeActiveFilterbarIfOpen(page);
  if (!assertMenu) return;
  await expect(page.locator('#navbar')).toHaveClass(menuOpen ? /^(?!.*collapsed)/ : /collapsed/);
  await expect(page.locator('#navbar')).not.toHaveClass(/navbar-opening/);
}

export async function captureHomeProbe(page: Page, info: TestInfo, name: string) {
  await page.screenshot({ path: info.outputPath(`${probePhase}-${name}.png`), fullPage: true, animations: 'disabled' });
}
