// G17_home_phone_search.spec.ts
// Proves phone Home search with response-only readable datasets and real PNG media.
// Reuses signed-in Home policy and polls history identity after same-document Back.
// No owner setting, account, dataset, language key or uploaded file is changed.
import { expect, test, type Page } from '@playwright/test';
import { installHomePolicy } from '../helpers/home-policy-fixture';

const datasets = ['app_e2e_search_beta', 'app_e2e_search_alpha', 'app_e2e_search_gamma'];
const imagePath = '/storage/app_e2e_home_search/300/landscape.png';
// Copied byte-for-byte from G15_home_boxes.spec.ts:12 (valid 32 × 32 PNG).
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAoUlEQVR4nO3RvQmAMBCG4cxm4RIOYmUjuIVDuYKVY6gQCOa83E+8swp81UHep0hYt8N1oQG/Aec+x7kAqf42DABQB0YD7P+gHyfaAHcdcNfj5E8UQKqrDCkA6nJDBKB1ocEDRF1iMABbZw0KENZpowio6oSBAxX1koEA1XXUgMDHely3DGnBqv6M4oBhFAFsoxAwj2aAR7QIWEUzwCPaANUuQRtBWxLcjQcAAAAASUVORK5CYII=', 'base64');
const copy = { front_page_search_site: 'Hae sivustolta', front_page_search_title: 'Haku',
  front_page_search_close: 'Sulje haku', front_page_search_searching: 'Haetaan…',
  front_page_search_no_results: 'Ei osumia', front_page_show_all: 'Näytä kaikki' };

async function fixture(page: Page, theme: 'light' | 'dark', width = 390) {
  const requests: URL[] = [];
  const forbidden: string[] = [];
  const writes: string[] = [];
  await installHomePolicy(page.context(), theme, { site_name: 'WO88', show_blocks: false });
  await page.context().route(/\/api\/(?:admin\/)?front-page(?:[/?]|$)/, async route => {
    if (route.request().method() === 'GET') return route.fallback();
    writes.push(route.request().method()); await route.abort();
  });
  await page.route(url => url.pathname === '/api/datasets', async route => {
    const response = await route.fetch(); expect(response.ok()).toBe(true);
    await route.fulfill({ response, json: { ...await response.json(),
      tab_order: datasets.map((dataset_name, sort_order) => ({ dataset_name, sort_order })),
      datasets: [...datasets.map((dataset_name, index) => ({ dataset_name, table_uid: 900565 + index,
        names: [dataset_name], preferred_name: dataset_name, is_top_level_in_current_project: true,
        can_read_rows: true, icon_key: 'table' })),
      { dataset_name: 'app_e2e_search_denied', can_read_rows: false, is_top_level_in_current_project: true }],
    } });
  });
  await page.route(url => url.pathname === '/api/translations', async route => {
    const response = await route.fetch(); expect(response.ok()).toBe(true);
    const data = await response.json();
    Object.assign(data.translations || data, copy, Object.fromEntries(datasets.map((name, i) => [name, `Matkat ${i + 1}`])));
    await route.fulfill({ response, json: data });
  });
  await page.route(url => url.pathname === '/api/get-results' && datasets.includes(url.searchParams.get('dataset') || ''), async route => {
    const url = new URL(route.request().url());
    const preview = url.searchParams.has('limit');
    if (preview) { requests.push(url); expect(url.searchParams.get('limit')).toBe('3'); }
    const empty = url.searchParams.get('search') === 'zznothing';
    await route.fulfill({ json: {
      data: empty ? [] : Array.from({ length: preview ? 3 : 4 }, (_, i) => ({ id: i + 1,
        title: `Harbour ${i + 1}`, description: 'Harbour travel and quiet northern scenery.', cached_image: imagePath })),
      columns: ['id', 'title', 'description'], types: { id: { data_type: 'integer' },
        title: { data_type: 'text', card_element: 'header', show_value_on_card: true },
        description: { data_type: 'text', card_element: 'description', show_value_on_card: true } },
      table_meta: {}, row_count: empty ? 0 : 4, resultsPerLoad: preview ? 3 : 20, userColumnSettings: [],
    } });
  });
  await page.route(url => url.pathname === imagePath, route => route.fulfill({ contentType: 'image/png', body: image }));
  page.on('request', request => {
    const url = new URL(request.url());
    if (/\/api\/.*(?:get-intelligent-results|get-results-vector|embed)/i.test(url.pathname)) forbidden.push(url.pathname);
    if (url.pathname === '/api/get-results' && url.searchParams.get('dataset') === 'app_e2e_search_denied') forbidden.push(url.pathname);
  });
  await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light', reducedMotion: 'reduce' });
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript(({ theme }) => {
    localStorage.setItem('theme', theme); localStorage.setItem('chosen_language', 'fi');
    localStorage.setItem('navVisibleWide', 'false'); localStorage.setItem('navVisibleNarrow', 'false');
  }, { theme });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#front_page_container')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}-mode\\b`));
  // The accepted tab projection, not Home's response, supplies the searchable list.
  await expect(page.locator('.hero-dataset-tabs__button[data-dataset^="app_e2e_search_"]')).toHaveCount(3);
  return { requests, forbidden, writes };
}

for (const theme of ['light', 'dark'] as const) {
  test(`phone Home search: bounds, images, close and Back in ${theme}`, async ({ page }, info) => {
    const { requests, forbidden, writes } = await fixture(page, theme);
    const button = page.locator('.front-page-search-button');
    const base = await page.evaluate(() => ({ url: location.href, id: history.state?.__filterestEntryId }));
    await button.click();
    const sheet = page.getByRole('dialog', { name: 'Haku', exact: true });
    const input = sheet.getByRole('searchbox');
    await expect(input).toBeFocused(); await expect(button).toHaveAttribute('aria-expanded', 'true');
    await expect(sheet).toHaveAttribute('aria-modal', 'true');
    await input.fill('h'); await page.waitForTimeout(400); expect(requests).toHaveLength(0);
    await input.fill('ha');
    await expect.poll(() => requests.length).toBe(3);
    const groups = sheet.locator('.supplemental-dataset-group:visible');
    await expect(groups).toHaveCount(3);
    expect(await groups.evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.dataset))).toEqual(datasets);
    for (let i = 0; i < 3; i++) {
      await expect(groups.nth(i).locator('li')).toHaveCount(3);
      const photo = groups.nth(i).locator('img').first();
      await photo.scrollIntoViewIfNeeded();
      await expect.poll(() => photo.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
    }
    await sheet.screenshot({ path: info.outputPath(`home-phone-search-${theme}.png`), animations: 'disabled' });
    await input.focus(); await page.keyboard.press('Shift+Tab');
    await expect(groups.last().locator('.supplemental-dataset-show-all')).toBeFocused();
    await page.keyboard.press('Tab'); await expect(input).toBeFocused();
    await sheet.getByRole('button', { name: 'Sulje haku' }).click();
    await expect(sheet).toHaveCount(0); await expect(button).toBeFocused();
    await expect.poll(() => page.evaluate(() => history.state?.homeSearch === true)).toBe(false);
    await button.click(); await page.keyboard.press('Escape'); await expect(sheet).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => history.state?.homeSearch === true)).toBe(false);
    await button.click(); await page.locator('.front-page-search-layer').click({ position: { x: 2, y: 150 } });
    await expect(sheet).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => history.state?.homeSearch === true)).toBe(false);
    await button.click();
    await page.goBack();
    // G5: goBack can resolve on an unrelated same-document write. Prove the actual landed entry.
    await expect.poll(() => page.url()).toBe(base.url);
    await expect.poll(() => page.evaluate(() => history.state?.__filterestEntryId)).toBe(base.id);
    await expect(sheet).toHaveCount(0); await expect(page.locator('#front_page_container')).toBeVisible();
    expect(forbidden).toEqual([]); expect(writes).toEqual([]);
  });

  test(`phone Home search: Show all opens the same dataset query in ${theme}`, async ({ page }) => {
    await fixture(page, theme);
    await page.getByRole('button', { name: 'Hae sivustolta', exact: true }).click();
    const sheet = page.getByRole('dialog'); await sheet.getByRole('searchbox').fill('harbour');
    const all = sheet.locator('.supplemental-dataset-show-all').first();
    await expect(all).toHaveAttribute('href', `/${datasets[0]}?search=harbour`);
    await all.click();
    await expect.poll(() => new URL(page.url()).pathname).toBe(`/${datasets[0]}`);
    await expect.poll(() => new URL(page.url()).searchParams.get('search')).toBe('harbour');
    await expect(sheet).toHaveCount(0);
    expect(await page.evaluate(() => history.state?.homeSearch)).toBeUndefined();
  });

  test(`desktop Home has no search button or sheet in ${theme}`, async ({ page }) => {
    const { requests } = await fixture(page, theme, 1440);
    await expect(page.locator('.front-page-search-button, .front-page-search-layer')).toHaveCount(0);
    expect(requests).toEqual([]);
  });
}
