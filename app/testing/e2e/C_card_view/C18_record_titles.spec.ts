// C18_record_titles.spec.ts
// Proves system, developer and freshly created records have names in native views.
// Connects real creation metadata, authorized listings, cards, tiles and articles.
// Exercises FI/EN and app themes opposite the OS; cleans the exact temporary dataset.
import { expect, test, type Page } from '@playwright/test';
import { login, loadCredentials } from '../helpers/auth';
import { buildTempDatasetName, createTempDataset, cleanupDatasetViaRequest, fetchCsrfTokenForRequest } from '../helpers/temp-dataset';
import { loadDatasetCardVisibility } from '../helpers/appearance-revisions';
import { waitForActiveFilterbarLayout } from '../helpers/filterbar';

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
          await page.goto(`/${name}?view=card`, { waitUntil: 'domcontentloaded' });
          await applyTheme(page, theme);
          await expect(page.locator('html')).toHaveAttribute('lang', language);
          // Choose from the rendered page, whose sort/page size can differ from API defaults.
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
          await expect(tile.locator('.product-card-view-title').first()).toHaveText(expected);

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
