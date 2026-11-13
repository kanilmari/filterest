// C21_record_titles.spec.ts
// Proves system, developer and freshly created records have names in native views.
// Connects real creation metadata, authorized listings, cards, tiles and articles.
// Exercises FI/EN and app themes opposite the OS; cleans the exact temporary dataset.
import { expect, test, type Page } from '@playwright/test';
import { login, loadCredentials } from '../helpers/auth';
import { buildTempDatasetName, createTempDataset, cleanupDatasetViaRequest, fetchCsrfTokenForRequest } from '../helpers/temp-dataset';
import { loadDatasetCardVisibility } from '../helpers/appearance-revisions';
import { waitForActiveFilterbarLayout } from '../helpers/filterbar';

function expectedProductTileTitle(text: string): string {
  // Mirrors MAX_TITLE_LENGTH and truncateText in product_card_view/product_card_view_printer.js.
  const maxTitleLength = 120;
  return text.length <= maxTitleLength ? text : `${text.slice(0, maxTitleLength - 3).trim()}...`;
}

async function datasetNameKey(page: Page, dataset: string): Promise<number | null> {
  const response = await page.request.get('/api/get-results', { params: { dataset: 'system_lang_keys', view_key: 'table', lang_key: dataset } });
  expect(response.ok(), await response.text()).toBe(true);
  const payload = await response.json() as { data: Array<{ id: number; lang_key: string }> };
  const rows = payload.data.filter(row => row.lang_key === dataset);
  expect(rows.length).toBeLessThanOrEqual(1);
  return rows[0]?.id ?? null;
}

async function applyTheme(page: Page, theme: 'light' | 'dark') {
  await waitForActiveFilterbarLayout(page);
  await page.evaluate(value => {
    document.body.classList.remove('light-mode', 'dark-mode', 'system-mode');
    document.body.classList.add(`${value}-mode`);
  }, theme);
  await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}-mode\\b`));
}

test('962: every record has the same name in cards, small summaries, product tiles and articles', async ({ page }) => {
  test.setTimeout(300_000);
  await login(page, loadCredentials());
  const dataset = buildTempDatasetName('e2e_962_titles');
  const originalLanguage = await page.evaluate(() => localStorage.getItem('chosen_language'));
  expect(await datasetNameKey(page, dataset)).toBeNull();
  let created = false;
  let nameKeyID: number | null = null;
  try {
    await createTempDataset(page, { datasetName: dataset,
      columns: { id: 'SERIAL', title: 'TEXT', content: 'TEXT', created: 'TIMESTAMPTZ NOT NULL DEFAULT NOW()' },
      seedRows: [{ title: 'Calendar 962', content: 'Description 962' }] });
    created = true;
    nameKeyID = await datasetNameKey(page, dataset);
    const metadata = await loadDatasetCardVisibility(page.request, dataset);
    const roles = Object.fromEntries(metadata.columns.map(column => [column.column_name, column.card_element]));
    expect(roles).toMatchObject({ title: 'header', content: 'description', created: 'details',
      created_by: 'hidden', owner_id: 'hidden' });

    for (const language of ['fi', 'en']) {
      await page.evaluate(value => localStorage.setItem('chosen_language', value), language);
      for (const theme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light' });
        for (const [name, field] of [['system_config', 'key'], ['system_db_tables', 'table_name'],
          ['dev_agent_tasks', 'title'], [dataset, 'title']]) {
          // Other workers delete their temporary registry rows while this test runs.
          // Pin the registry proof to a system table that survives their cleanup.
          let stableID: number | undefined;
          if (name === 'system_db_tables') {
            const stable = await page.request.get('/api/get-results', {
              params: { dataset: name, view_key: 'card', table_name: 'system_config' },
            });
            expect(stable.ok(), await stable.text()).toBe(true);
            const records = (await stable.json()).data as Array<{ id: number; table_name: string }>;
            stableID = records.find(row => row.table_name === 'system_config')?.id;
            expect(stableID).toBeGreaterThan(0);
          }
          await page.goto(`/${name}?view=card${stableID ? `&id=${stableID}` : ''}`, { waitUntil: 'domcontentloaded' });
          await applyTheme(page, theme);
          await expect(page.locator('html')).toHaveAttribute('lang', language);
          // Choose from the rendered page; the registry listing is pinned to its stable ID.
          const firstCard = page.locator(`#${name}_card_view_container [data-testid="card-item"]`).first();
          await expect(firstCard).toBeVisible();
          await expect(firstCard).toHaveAttribute('data-id', /^\d+$/);
          const id = (await firstCard.getAttribute('data-id'))!;
          // The article reader uses this same exact-id filter on get-results.
          const response = await page.request.get('/api/get-results', {
            params: { dataset: name, view_key: 'card', id, lang: language },
          });
          expect(response.ok(), await response.text()).toBe(true);
          const payload = await response.json() as { data: Array<Record<string, unknown>> };
          const row = payload.data.find(item => String(item.id) === id);
          expect(typeof row?.[field], `Rendered row ${id} in ${name} requires a readable ${field}`).toBe('string');
          const expected = String(row![field]).trim();
          expect(expected).not.toBe('');
          const card = page.locator(`#${name}_card_view_container [data-testid="card-item"][data-id="${id}"]`).first();
          await expect(card.locator('.header_value').first()).toHaveText(expected);
          await expect(card.locator('.small_card_name_text')).toHaveText(expected);

          // Filtering to this ID keeps the same record on page one even with another tile order.
          await page.goto(`/${name}?view=product_card&id=${id}`, { waitUntil: 'domcontentloaded' });
          await applyTheme(page, theme);
          const tile = page.locator(`[data-testid="product-card"][data-row-id="${id}"]`).first();
          const heading = tile.locator('.product-card-view-title').first();
          await expect(heading).toHaveAttribute('title', expected);
          await expect(heading).toHaveText(expectedProductTileTitle(expected));

          await page.goto(`/${name}/${id}?view=article_view`, { waitUntil: 'domcontentloaded' });
          await applyTheme(page, theme);
          await expect(page.locator('.active_row_article .big_card_header_value').first()).toHaveText(expected);
        }
      }
    }
  } finally {
    try {
      if (created) {
        nameKeyID ??= await datasetNameKey(page, dataset);
        await cleanupDatasetViaRequest(page.request, dataset);
        const remaining = await datasetNameKey(page, dataset);
        if (remaining !== null) {
          expect(remaining).toBe(nameKeyID);
          const csrf = await fetchCsrfTokenForRequest(page.request);
          const deletion = await page.request.post('/api/delete-rows?dataset=system_lang_keys', {
            headers: { 'X-CSRF-Token': csrf }, data: { ids: [remaining] },
          });
          expect(deletion.ok(), await deletion.text()).toBe(true);
          expect(await datasetNameKey(page, dataset)).toBeNull();
        }
      }
    } finally {
      await page.evaluate(value => {
        if (value === null) localStorage.removeItem('chosen_language');
        else localStorage.setItem('chosen_language', value);
      }, originalLanguage);
    }
  }
});

// Read through the native builders on an existing dataset. Only this browser's
// two result rows and its dataset palette vary; all requests to the seed are reads.
test('#1013 stored heading tags keep the title size and name on cards, search and articles', async ({ page }, info) => {
  const inventory = await page.request.get('/api/datasets');
  expect(inventory.ok()).toBe(true);
  const { datasets } = await inventory.json();
  const dataset = ['dokumentaatio', 'app_service_catalog'].find(name =>
    datasets.some((item: { dataset_name: string; can_read_rows?: boolean }) =>
      item.dataset_name === name && item.can_read_rows !== false));
  if (!dataset) throw Error('The native seed needs a readable example dataset');

  const seed = await page.request.get('/api/get-results', { params: { dataset, view_key: 'card', limit: 2 } });
  expect(seed.ok()).toBe(true);
  const listing = await seed.json();
  const ids: number[] = listing.data.slice(0, 2).map((row: { id: number }) => Number(row.id));
  expect(ids).toHaveLength(2);
  const name = 'Hotel payment request';
  const marked = `<h1>${name}</h1>`;
  const rows = ids.map((id, index) => ({ id, title: index ? marked : name, content: '<h3>Section</h3><p>Article body</p>' }));
  let style = 'standard';
  await page.route(url => url.pathname === '/api/get-results' && url.searchParams.get('dataset') === dataset, async route => {
    const url = new URL(route.request().url());
    const id = url.searchParams.get('id');
    const data = id ? rows.filter(row => row.id === Number(id)) : rows;
    await route.fulfill({ json: { ...listing, columns: ['id', 'title', 'content'], types: {
      id: { data_type: 'integer' }, title: { card_element: 'header', data_type: 'text', show_value_on_card: true },
      content: { card_element: 'description', data_type: 'text', show_value_on_card: true },
    }, dataset_appearance: { ...listing.dataset_appearance, overrides: {
      ...listing.dataset_appearance.overrides, 'shared.card_style_variant': style,
    } }, data, row_count: data.length } });
  });

  // A wrapper retains its CSS size even if a nested h1 doubles the glyphs.
  // Measure the parent of the text the browser paints.
  function measureTitle(element: Element) {
    const text = document.createTreeWalker(element, NodeFilter.SHOW_TEXT).nextNode()!;
    return { text: element.textContent!.trim(), px: parseFloat(getComputedStyle(text.parentElement!).fontSize) };
  }
  const measurements = [];
  for (const variant of ['standard', 'modern']) {
    style = variant;
    await page.goto(`/${dataset}?view=card${variant === 'modern' ? '&search=Hotel' : ''}`);
    const listingCard = (id: number) => page.locator(`.card[data-card-presentation-view="card"][data-id="${id}"]:visible`).first();
    await expect(listingCard(ids[1])).toHaveAttribute('data-card-style-variant', variant);
    const headers = await Promise.all(ids.map(id => listingCard(id).locator('.header_value').first().evaluate(measureTitle)));
    measurements.push({ variant, headers });
    expect.soft(headers[0].px).toBeGreaterThan(0);
    expect.soft(headers[1]).toEqual(headers[0]);
    await expect.soft(listingCard(ids[1]).locator('.card_header').first()).toHaveAttribute('title', name);
    await expect.soft(listingCard(ids[1]).locator('.header_value h1')).toHaveCount(0);
  }
  const articleHeaders = [];
  for (const [index, id] of ids.entries()) {
    // A bookmarked tagged-title slug must still address the same row.
    const slug = index ? 'h1hotel-payment-requesth1' : 'hotel-payment-request';
    await page.goto(`/${dataset}/${id}-${slug}?view=article_view`);
    const article = page.locator('.active_row_article .big_card_header_value').first();
    await expect(article).toBeVisible();
    articleHeaders.push(await article.evaluate(measureTitle));
    await expect.soft(article).toHaveAttribute('data-raw-value', rows[index].title);
    await expect.soft(page.locator('.active_row_article .big_description_value h3')).toHaveText('Section');
    await expect.soft(page).toHaveTitle(/^Hotel payment request(?: — |$)/);
    const rail = page.locator(`.article_view_wrapper .card[data-id="${ids[1]}"] .small_card_name_text`).first();
    await expect.soft(rail).toHaveText(name);
  }
  expect.soft(articleHeaders[0].px).toBeGreaterThan(0);
  expect.soft(articleHeaders[1]).toEqual(articleHeaders[0]);
  await info.attach('title-font-sizes', { body: JSON.stringify({ measurements, articleHeaders }), contentType: 'application/json' });
});
