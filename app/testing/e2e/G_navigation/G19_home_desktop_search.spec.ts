// G19_home_desktop_search.spec.ts
// Proves D1 breakpoints, native tab fitting and nonmodal desktop search gestures.
// Uses signed-in storageState and response-only GET fixtures, with no settings saves.
// Aborts every non-GET before it reaches the target; G17 retains phone history coverage.
import { expect, test, type Page } from '@playwright/test';
import { installHomePolicy } from '../helpers/home-policy-fixture';
import { LAYOUT_BREAKPOINTS } from '../../../frontend/ui_config.js';

const { phone, tablet } = LAYOUT_BREAKPOINTS;
const docked = LAYOUT_BREAKPOINTS.navbarCollapsed + 70; // 1920: the side menu docks beside Home

const datasets = ['app_e2e_desktop_travel', 'app_e2e_desktop_news', 'app_e2e_desktop_articles'];
const imagePath = '/storage/app_e2e_desktop_search/300/landscape.png';
// Same valid PNG as G17; fixtures exist only in browser responses.
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAoUlEQVR4nO3RvQmAMBCG4cxm4RIOYmUjuIVDuYKVY6gQCOa83E+8swp81UHep0hYt8N1oQG/Aec+x7kAqf42DABQB0YD7P+gHyfaAHcdcNfj5E8UQKqrDCkA6nJDBKB1ocEDRF1iMABbZw0KENZpowio6oSBAxX1koEA1XXUgMDHely3DGnBqv6M4oBhFAFsoxAwj2aAR7QIWEUzwCPaANUuQRtBWxLcjQcAAAAASUVORK5CYII=', 'base64');
const copy = { front_page_search_site: 'Hae sivustolta', front_page_search_title: 'Haku',
  front_page_search_close: 'Sulje haku', front_page_search_searching: 'Haetaan…',
  front_page_search_no_results: 'Ei osumia', front_page_show_all: 'Näytä kaikki' };

async function fixture(page: Page, width: number, theme: 'light' | 'dark', longLabels = false) {
  const reads: URL[] = [], blocked: string[] = [];
  await installHomePolicy(page.context(), theme, {
    site_name: longLabels ? 'Pohjoisen matkailupalveluiden yhteinen tietopalvelu' : 'WO88', show_blocks: false,
  });
  await page.route(url => url.pathname === '/api/datasets', async route => {
    expect(route.request().method()).toBe('GET');
    const response = await route.fetch(); expect(response.ok()).toBe(true);
    await route.fulfill({ response, json: { ...await response.json(),
      tab_order: datasets.map((dataset_name, sort_order) => ({ dataset_name, sort_order })),
      datasets: datasets.map((dataset_name, index) => ({ dataset_name, table_uid: 900573 + index,
        names: [dataset_name], preferred_name: dataset_name, is_top_level_in_current_project: true,
        can_read_rows: true, icon_key: 'table' })),
    } });
  });
  await page.route(url => url.pathname === '/api/translations', async route => {
    expect(route.request().method()).toBe('GET');
    const response = await route.fetch(); expect(response.ok()).toBe(true);
    const data = await response.json();
    Object.assign(data.translations || data, copy, Object.fromEntries(datasets.map((name, index) => [name,
      // Long enough that three tabs overflow even the 1920 px row, before and after the menu docks.
      longLabels ? `Pohjois-Suomen ja Lapin matkailupalveluiden ajankohtaiset tiedotteet, tapahtumat ja ohjelmat ${index + 1}`
        : ['Matkat', 'Uutiset', 'Artikkelit'][index]])));
    await route.fulfill({ response, json: data });
  });
  await page.route(url => url.pathname === '/api/get-results' && datasets.includes(url.searchParams.get('dataset') || ''), async route => {
    expect(route.request().method()).toBe('GET');
    const url = new URL(route.request().url()); reads.push(url);
    expect(url.searchParams.get('limit')).toBe('3');
    expect(url.searchParams.get('view_key')).toBe('card');
    expect(url.searchParams.get('include_card_support')).toBe('1');
    await route.fulfill({ json: {
      data: Array.from({ length: 3 }, (_, index) => ({ id: index + 1, title: `Helsinki ${index + 1}`,
        description: 'Helsinki: matkoja ja pohjoisia maisemia.', cached_image: imagePath })),
      columns: ['id', 'title', 'description'], types: { id: { data_type: 'integer' },
        title: { data_type: 'text', card_element: 'header', show_value_on_card: true },
        description: { data_type: 'text', card_element: 'description', show_value_on_card: true } },
      table_meta: {}, row_count: 3, resultsPerLoad: 3, userColumnSettings: [],
    } });
  });
  await page.route(url => url.pathname === imagePath, route => route.fulfill({ contentType: 'image/png', body: image }));
  // Registered last on the page: guards every fixture and the context policy's simulated writer.
  await page.route('**/*', async route => {
    if (route.request().method() === 'GET') return route.fallback();
    blocked.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
    await route.abort('blockedbyclient');
  });
  await page.routeWebSocket('**/*', () => {});
  await page.setViewportSize({ width, height: 1000 });
  await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light', reducedMotion: 'reduce' });
  await page.addInitScript(theme => {
    localStorage.setItem('theme', theme); localStorage.setItem('chosen_language', 'fi');
    localStorage.setItem('navVisibleWide', 'false'); localStorage.setItem('navVisibleNarrow', 'false');
  }, theme);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#front_page_container')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}-mode\\b`));
  await expect(page.locator('.hero-dataset-tabs__button[data-dataset^="app_e2e_desktop_"]')).toHaveCount(3);
  const profile = await page.request.get('/api/user-profile');
  expect(profile.ok()).toBe(true); expect((await profile.json()).user_id).toBeGreaterThan(1);
  // Count pushes only after Home's own initial navigation settles.
  await page.evaluate(() => {
    const original = history.pushState.bind(history);
    (window as Window & { __desktopSearchPushes?: number }).__desktopSearchPushes = 0;
    history.pushState = (...args) => {
      (window as Window & { __desktopSearchPushes: number }).__desktopSearchPushes++;
      original(...args);
    };
  });
  return { reads, blocked };
}

async function noTabOverlap(page: Page) {
  await expect.poll(() => page.locator('.front-page-top-row').evaluate(row => {
    const host = row.querySelector('.front-page-desktop-search')!.getBoundingClientRect();
    const nav = row.querySelector('.hero-dataset-tabs')!.getBoundingClientRect();
    return [...row.querySelectorAll<HTMLElement>('.hero-dataset-tabs > *')].every(node => {
      if (node.hidden || !node.getClientRects().length) return true;
      const box = node.getBoundingClientRect();
      const apart = box.right <= host.left + 1 || box.left >= host.right - 1
        || box.bottom <= host.top + 1 || box.top >= host.bottom - 1;
      return apart && box.left >= nav.left - 1 && box.right <= nav.right + 1;
    });
  })).toBe(true);
}

async function openSearch(page: Page, width: number) {
  const host = page.locator('.front-page-desktop-search');
  if (width <= tablet) await host.getByRole('button', { name: 'Hae sivustolta' }).click();
  const input = width > tablet ? host.getByRole('searchbox') : page.locator('#front-page-desktop-search-panel input');
  await input.fill('Helsinki');
  const panel = page.locator('#front-page-desktop-search-panel');
  await expect(panel).toBeVisible(); await expect(panel).toHaveAttribute('aria-modal', 'false');
  await expect(panel.locator('.supplemental-dataset-group:visible')).toHaveCount(3);
  for (const group of await panel.locator('.supplemental-dataset-group:visible').all()) {
    await expect(group.locator('li')).toHaveCount(3);
  }
  const photo = panel.locator('img').first();
  await expect.poll(() => photo.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
  await expect(panel.locator('.supplemental-dataset-show-all').first()).toHaveAttribute('href', `/${datasets[0]}?search=Helsinki`);
  const anchor = await (width > tablet ? host : host.getByRole('button')).boundingBox();
  const box = (await panel.boundingBox())!;
  const home = (await page.locator('#front_page_container').boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(anchor!.y + anchor!.height + 7);
  expect(box.x).toBeGreaterThanOrEqual(Math.max(16, home.x + 16) - 1);
  expect(box.x + box.width).toBeLessThanOrEqual(Math.min(page.viewportSize()!.width - 16, home.x + home.width - 16) + 1);
  expect(box.width).toBeCloseTo(Math.min(640, home.width - 32, page.viewportSize()!.width - 32), 0);
  expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height - 15);
  await expect(input).toBeFocused();
  await noTabOverlap(page);
  return { panel, input };
}

test.use({ serviceWorkers: 'block' });
for (const theme of ['light', 'dark'] as const) {
  for (const width of [1440, tablet + 1, tablet, 1000, phone + 1]) {
    test(`D1 ${width} ${theme}: geometry, results, close and focus without a history entry`, async ({ page }) => {
      const { reads, blocked } = await fixture(page, width, theme);
      const host = page.locator('.front-page-desktop-search');
      const trigger = width > tablet ? host.getByRole('searchbox') : host.getByRole('button');
      await expect(host).toHaveAttribute('data-mode', width > tablet ? 'field' : 'button');
      expect((await host.boundingBox())!.width).toBeCloseTo(width > tablet ? 280 : 44, 0);
      expect((await host.boundingBox())!.height).toBeCloseTo(44, 0);
      await expect(page.locator('.front-page-search-button')).toHaveCount(0);
      await noTabOverlap(page);
      const state = await page.evaluate(() => ({ state: history.state, url: location.href, length: history.length }));
      let { panel } = await openSearch(page, width);
      await panel.getByRole('button', { name: 'Sulje haku' }).click();
      await expect(panel).toHaveCount(0); await expect(trigger).toBeFocused();
      ({ panel } = await openSearch(page, width));
      await page.keyboard.press('Escape'); await expect(panel).toHaveCount(0); await expect(trigger).toBeFocused();
      ({ panel } = await openSearch(page, width));
      // Click outside in the 16 px gutter beside the panel: at 701–1201 px the panel covers the hero's corner.
      const outside = (await panel.boundingBox())!;
      await page.mouse.click(outside.x - 8, outside.y + 24);
      await expect(panel).toHaveCount(0); await expect(trigger).toBeFocused();
      expect(await page.evaluate(() => ({ state: history.state, url: location.href, length: history.length }))).toEqual(state);
      expect(await page.evaluate(() => (window as Window & { __desktopSearchPushes: number }).__desktopSearchPushes)).toBe(0);
      expect(reads.length).toBeGreaterThanOrEqual(3);
      expect(blocked.filter(value => /\/api\/(?:admin\/)?front-page/.test(value))).toEqual([]);
    });
  }

  for (const width of [phone, 390]) {
    test(`D1 ${width} ${theme}: only batch 565's phone button and modal sheet`, async ({ page }) => {
      await fixture(page, width, theme);
      await expect(page.locator('.front-page-desktop-search')).toHaveCount(0);
      const button = page.locator('.front-page-phone-topbar__end .front-page-search-button');
      await button.click();
      const sheet = page.locator('#front-page-search-sheet');
      await expect(sheet).toHaveAttribute('aria-modal', 'true');
      await expect(sheet.getByRole('searchbox')).toBeFocused();
      await sheet.getByRole('searchbox').fill('Helsinki');
      await expect(sheet.locator('.supplemental-dataset-group:visible')).toHaveCount(3);
      await page.keyboard.press('Escape'); await expect(sheet).toHaveCount(0);
      await expect(button).toBeFocused();
      await expect.poll(() => page.evaluate(() => history.state?.homeSearch === true)).toBe(false);
    });
  }

  test(`D1 ${theme}: crossing ${tablet}/${tablet + 1} and ${phone + 1}/${phone} closes and transfers focus between real triggers`, async ({ page }) => {
    await fixture(page, tablet, theme);
    await openSearch(page, tablet);
    await page.setViewportSize({ width: tablet + 1, height: 1000 });
    await expect(page.locator('#front-page-desktop-search-panel')).toHaveCount(0);
    await expect(page.locator('.front-page-desktop-search input')).toBeFocused();
    await openSearch(page, tablet + 1);
    await page.setViewportSize({ width: tablet, height: 1000 });
    await expect(page.locator('#front-page-desktop-search-panel')).toHaveCount(0);
    await expect(page.locator('.front-page-desktop-search__button')).toBeFocused();
    await openSearch(page, tablet);
    await page.setViewportSize({ width: phone, height: 1000 });
    await expect(page.locator('.front-page-desktop-search')).toHaveCount(0);
    const phoneButton = page.locator('.front-page-search-button'); await expect(phoneButton).toBeFocused();
    await phoneButton.click(); await expect(page.locator('#front-page-search-sheet')).toBeVisible();
    await page.setViewportSize({ width: phone + 1, height: 1000 });
    await expect(page.locator('#front-page-search-sheet')).toHaveCount(0);
    await expect(page.locator('.front-page-desktop-search__button')).toBeFocused();
    await expect.poll(() => page.evaluate(() => history.state?.homeSearch === true)).toBe(false);
    await openSearch(page, phone + 1);
    await page.setViewportSize({ width: tablet + 1, height: 1000 });
    await expect(page.locator('#front-page-desktop-search-panel')).toHaveCount(0);
    await expect(page.locator('.front-page-desktop-search input')).toBeFocused();
  });

  // The side menu docks only above navbarCollapsed (1850 px); at or below it the menu overlays Home.
  test(`D1 ${docked} ${theme}: docked menu and GET-only long labels hide whole tabs without overlap`, async ({ page }) => {
    await fixture(page, docked, theme, true);
    const tabs = page.locator('.front-page-top-row .hero-dataset-tabs__button');
    await expect.poll(() => tabs.evaluateAll(nodes => nodes.filter(node => (node as HTMLElement).hidden).length)).toBeGreaterThan(0);
    const hiddenBefore = await tabs.evaluateAll(nodes => nodes.filter(node => (node as HTMLElement).hidden).length);
    await page.locator('.front-page-top-row #showMenuButton').click();
    const navbar = page.locator('#navbar'); await expect(navbar).not.toHaveClass(/\bcollapsed\b/);
    await expect(navbar).not.toHaveClass(/navbar-opening/);
    const menu = (await navbar.boundingBox())!;
    // Docking slides #tabs_container (and Home inside it) by the menu width over a 0.7 s transition (base.css).
    await expect.poll(async () => (await page.locator('#front_page_container').boundingBox())!.x,
      { message: 'Home settles beside the docked menu', timeout: 5000 }).toBeGreaterThanOrEqual(menu.x + menu.width - 1);
    await noTabOverlap(page);
    expect(await tabs.evaluateAll(nodes => nodes.filter(node => (node as HTMLElement).hidden).length)).toBeGreaterThanOrEqual(hiddenBefore);
    for (const dataset of datasets) await expect(navbar.locator(`button[data-id="${dataset}"]`)).toHaveCount(1);
    const { panel } = await openSearch(page, docked);
    expect((await panel.boundingBox())!.x).toBeGreaterThanOrEqual(menu.x + menu.width + 15);
  });
}
