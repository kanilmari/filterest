// C14_product_card_row_commits.spec.ts
// Proves product-card IDs and pictures across refresh, search, clear and real pagination.
// Connects a registered throwaway dataset, live listing payloads and the visible card surface.
// Covers Finnish/English and application themes over opposite OS preferences; cleans up via API.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { login, loadCredentials } from '../helpers/auth';
import { buildTempDatasetName, createTempDataset, cleanupDatasetViaRequest,
  fetchCsrfTokenForRequest } from '../helpers/temp-dataset';
import { openActiveDatasetSearch } from '../helpers/dataset-search';
import { closeActiveFilterbarIfOpen, revealActiveFilterbarSection, waitForActiveFilterbarLayout } from '../helpers/filterbar';
import { firstVisibleByTestId } from '../helpers/navigation';
import { scrollActiveContentToBottom } from '../helpers/scroll';
import { switchToView } from '../helpers/view-switch';
import { saveCardVisibilityWithFreshRevisions } from '../helpers/appearance-revisions';
import { ensureNavbarVisible } from '../helpers/navbar';

type ListingRow = { id: number; name: string; thumbnail: string };
const picture = (id: number) => `/frontend/favicon4E.png?wl162=${id}`;
const idsFrom = (rows: ListingRow[]) => rows.map(row => String(row.id));
const range = (first: number, last: number) => Array.from({ length: last - first + 1 }, (_, i) => String(first + i));

function listingResponse(page: Page, dataset: string, offset = 0, search = '') {
  return page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === '/api/get-results' && url.searchParams.get('dataset') === dataset
      && url.searchParams.get('view_key') === 'product_card'
      && Number(url.searchParams.get('offset') || 0) === offset
      && (url.searchParams.get('search') || '') === search;
  });
}

/** Verify identities and each row's actual image source, including cards outside the scroll viewport. */
async function expectCards(root: Locator, ids: string[]) {
  const cards = root.getByTestId('product-card');
  await expect.poll(() => cards.evaluateAll(elements => elements.map(element => (element as HTMLElement).dataset.rowId)))
    .toEqual(ids);
  expect(new Set(ids).size).toBe(ids.length);
  for (const id of ids) {
    const card = root.locator(`[data-testid="product-card"][data-row-id="${id}"]`);
    await expect(card).toBeVisible();
    await expect(card.locator('img.product-card-view-image')).toHaveAttribute('src', picture(Number(id)));
  }
}

async function expectLoadedPicture(root: Locator, id: string) {
  const image = root.locator(`[data-row-id="${id}"] img.product-card-view-image`);
  await image.scrollIntoViewIfNeeded();
  await expect.poll(() => image.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
}

async function refreshThroughControl(page: Page) {
  await waitForActiveFilterbarLayout(page);
  // The optional search_controls section is disabled. All three viewports
  // expose Reset search in the content hero; close the panel before clicking it.
  await closeActiveFilterbarIfOpen(page);
  await firstVisibleByTestId(page, 'btn-reset-search-content-hero').click();
}

async function switchToProductCards(page: Page, root: Locator) {
  const views = await revealActiveFilterbarSection(page, 'views');
  await views.getByTestId('view-dropdown-more-trigger').click();
  // Dropdown options are portalled outside the filterbar section; their generated
  // test IDs normalize underscores to hyphens (vanilla_dropdown_builder.js).
  const option = firstVisibleByTestId(page, 'view-dropdown-more-option-product-card');
  await expect(option).toBeVisible({ timeout: 5000 });
  await option.click({ timeout: 5000 });
  await closeActiveFilterbarIfOpen(page);
  await expect(root).toBeVisible();
}

async function applyPageTheme(page: Page, theme: 'light' | 'dark') {
  // Authenticated startup restores the account theme, including after F5.
  // Apply this page-only fixture after it settles, without saving account preferences.
  await waitForActiveFilterbarLayout(page);
  await page.evaluate(theme => {
    document.body.classList.remove('light-mode', 'dark-mode', 'system-mode');
    document.body.classList.add(`${theme}-mode`);
  }, theme);
  await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}-mode\\b`));
}

test('product-card refresh/search/clear/pages keep exact row IDs and pictures in both themes and languages', async ({ page }) => {
  test.setTimeout(240_000);
  await login(page, loadCredentials());
  // Read the native page size instead of relying on a particular installation's setting.
  const config = await page.request.get('/api/get-results?dataset=system_config&view_key=table&key=results_load_amount');
  expect(config.ok(), await config.text()).toBe(true);
  const pageSize = Number((await config.json()).resultsPerLoad);
  expect(Number.isSafeInteger(pageSize)).toBe(true);
  expect(pageSize, 'Use a card-test instance with 12–100 rows per load, so the first page needs scrolling.').toBeGreaterThanOrEqual(12);
  expect(pageSize).toBeLessThanOrEqual(100);
  const dataset = buildTempDatasetName('e2e_wl162_product_cards');
  const needleId = pageSize + 2;
  const needle = 'wl162uniquematch';
  let created = false;
  try {
    await createTempDataset(page, { datasetName: dataset,
      columns: { id: 'SERIAL', name: 'TEXT', thumbnail: 'TEXT', category: 'TEXT' },
      // Pictures use a shipped local raster asset with a row-specific URL. No uploads or external hosts.
      seedRows: Array.from({ length: pageSize * 2 }, (_, index) => ({
        name: index + 1 === needleId ? needle : `Product / Tuote ${index + 1}`,
        thumbnail: picture(index + 1), category: 'Equipment / Varusteet',
      })) });
    created = true;
    const roles: Record<string, string> = { name: 'header', thumbnail: 'image', category: 'details' };
    await saveCardVisibilityWithFreshRevisions(page.request, dataset, visibility => ({
      columns: visibility.columns.map(column => roles[column.column_name] ? {
        ...column, card_element: roles[column.column_name], show_value_on_card: true,
      } : column),
    }));
    const root = page.locator(`#${dataset}_product_card_view_container [data-testid="product-card-view"]`);
    let firstId = 1;
    for (const theme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light' });
      await page.evaluate(() => localStorage.setItem('chosen_language', 'en'));
      const firstResponse = listingResponse(page, dataset);
      await page.goto(`/${dataset}?view=product_card&sort_column=id&sort_order=ASC`, { waitUntil: 'domcontentloaded' });
      await expect(root).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      await applyPageTheme(page, theme);
      const first = await (await firstResponse).json() as { data: ListingRow[] };
      expect(idsFrom(first.data)).toEqual(range(firstId, firstId + pageSize - 1));
      await expectCards(root, idsFrom(first.data));
      await expectLoadedPicture(root, String(firstId));

      // Remove a known shown row through the API. Refresh must replace its card and picture.
      const csrf = await fetchCsrfTokenForRequest(page.request);
      const deletion = await page.request.post(`/api/delete-rows?dataset=${dataset}`, {
        headers: { 'X-CSRF-Token': csrf }, data: { ids: [firstId] },
      });
      expect(deletion.ok(), await deletion.text()).toBe(true);
      firstId += 1;
      const refreshResponse = listingResponse(page, dataset);
      await refreshThroughControl(page);
      const refreshed = await (await refreshResponse).json() as { data: ListingRow[] };
      expect(idsFrom(refreshed.data)).toEqual(range(firstId, firstId + pageSize - 1));
      await expectCards(root, idsFrom(refreshed.data));
      await expectLoadedPicture(root, String(firstId));

      let search = await openActiveDatasetSearch(page);
      const searchResponse = listingResponse(page, dataset, 0, needle);
      await search.fill(needle); await search.press('Enter');
      const found = await (await searchResponse).json() as { data: ListingRow[] };
      expect(idsFrom(found.data)).toEqual([String(needleId)]);
      await closeActiveFilterbarIfOpen(page);
      await expectCards(root, [String(needleId)]);
      await expectLoadedPicture(root, String(needleId));

      search = await openActiveDatasetSearch(page);
      const emptyResponse = listingResponse(page, dataset, 0, 'wl162nomatches');
      await search.fill('wl162nomatches'); await search.press('Enter');
      expect((await (await emptyResponse).json()).data).toEqual([]);
      await expectCards(root, []);
      await expect(root.getByTestId('product-card-empty')).toBeVisible();

      search = await openActiveDatasetSearch(page);
      const clearResponse = listingResponse(page, dataset);
      await search.fill('');
      const cleared = await (await clearResponse).json() as { data: ListingRow[] };
      expect(idsFrom(cleared.data)).toEqual(range(firstId, firstId + pageSize - 1));
      await closeActiveFilterbarIfOpen(page);
      await expectCards(root, idsFrom(cleared.data));

      const nextResponse = listingResponse(page, dataset, pageSize);
      await scrollActiveContentToBottom(page);
      const next = await (await nextResponse).json() as { data: ListingRow[] };
      expect(idsFrom(next.data)).toEqual(range(firstId + pageSize, pageSize * 2));
      const allIds = [...idsFrom(cleared.data), ...idsFrom(next.data)];
      await expectCards(root, allIds);
      await expectLoadedPicture(root, String(firstId + pageSize));
      await ensureNavbarVisible(page);
      const navbar = page.locator('#navbar');
      const beforeLanguage = await root.getByTestId('product-card').first().elementHandle();
      await navbar.getByTestId('language-menu-button').click();
      await navbar.getByTestId('language-menu-option-fi').check();
      await expect(page.locator('html')).toHaveAttribute('lang', 'fi');
      await navbar.locator('#hideMenuButton').click();
      // Wait for the product language renderer, so unchanged IDs cannot pass on old cards.
      await expect.poll(() => beforeLanguage!.evaluate(element => element.isConnected)).toBe(false);
      await beforeLanguage!.dispose();
      await expectCards(root, allIds);
      await expectLoadedPicture(root, String(firstId + pageSize));

      // Cold reload and view switching keep the chosen presentation and its fresh first page.
      // Return to the first card before reload so restored scrolling cannot request page two.
      await expectLoadedPicture(root, String(firstId));
      const reloadResponse = listingResponse(page, dataset);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await reloadResponse;
      await applyPageTheme(page, theme);
      await expect(page.locator('html')).toHaveAttribute('lang', 'fi');
      await expectCards(root, idsFrom(cleared.data));
      await expectLoadedPicture(root, String(firstId));
      // Reveal Views temporarily; the shared switch helper can then use its real button
      // without changing the installation's saved disclosure layout.
      await revealActiveFilterbarSection(page, 'views');
      await switchToView(page, 'table');
      await closeActiveFilterbarIfOpen(page);
      await expect(root).toBeHidden();
      // The selector refreshes page zero and the table commit clears the old cards.
      // Pair the response wait with selection so a missing control fails promptly
      // while the authenticated page is still available for finally cleanup.
      const [switchResponse] = await Promise.all([
        listingResponse(page, dataset),
        switchToProductCards(page, root),
      ]);
      const switched = await switchResponse.json() as { data: ListingRow[] };
      expect(idsFrom(switched.data)).toEqual(range(firstId, firstId + pageSize - 1));
      await expectCards(root, idsFrom(cleared.data));
      await expectLoadedPicture(root, String(firstId));
      await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}-mode\\b`));
    }
  } finally {
    if (created) await cleanupDatasetViaRequest(page.request, dataset);
  }
});
