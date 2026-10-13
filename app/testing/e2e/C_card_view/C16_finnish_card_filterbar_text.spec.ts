// C16_finnish_card_filterbar_text.spec.ts
// Proves Finnish card/filterbar text and an empty date on a disposable native dataset.
// Connects the server dictionaries loaded by the page, card controls and article details.
// Supplies only fixture labels; product translations remain the server's own.
import { expect, test, type APIRequestContext } from '@playwright/test';
import type { DatasetAppearanceResponse } from '../../../frontend/generated/go_contract_types';
import { login, loadCredentials } from '../helpers/auth';
import { buildTempDatasetName, createTempDataset, dropTempDataset, fetchCsrfTokenForRequest } from '../helpers/temp-dataset';
import { readLangKeyInventory } from '../helpers/test-artifact-cleanup';
import { loadDatasetCardVisibility, saveCardVisibilityWithFreshRevisions } from '../helpers/appearance-revisions';
import { openActiveDatasetSearch } from '../helpers/dataset-search';
import { closeActiveFilterbarIfOpen, revealActiveFilterbarSection, waitForActiveFilterbarLayout } from '../helpers/filterbar';
import { firstVisibleByTestId } from '../helpers/navigation';
import { closeBigCard, openBigCard } from '../helpers/view-switch';

// Product source: get_results_query.go:92 accepts column filters; the returned
// id is the deletion identity (delete_row.go:80). Never delete by a name prefix.
// base.schema.sql:232,235 defines the primary id and unique language key.
async function readDatasetNameKeyId(request: APIRequestContext, dataset: string): Promise<number | null> {
  const response = await request.get('/api/get-results', {
    params: { dataset: 'system_lang_keys', lang_key: dataset, offset: 0 },
  });
  expect(response.ok(), await response.text()).toBe(true);
  const payload = await response.json() as { data: Array<{ id: number; lang_key: string }> };
  const rows = payload.data.filter(row => row.lang_key === dataset);
  expect(rows.length, 'Language keys are unique: system_lang_keys.lang_key').toBeLessThanOrEqual(1);
  if (!rows.length) return null;
  expect(Number.isSafeInteger(rows[0].id) && rows[0].id > 0).toBe(true);
  return rows[0].id;
}

test('Finnish sort/count/add-row and empty date stay translated in cards and article details', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, loadCredentials());
  const originalLanguage = await page.evaluate(() => localStorage.getItem('chosen_language'));
  const dataset = buildTempDatasetName('e2e_card_texts_fi');
  // Source: test-artifact-cleanup.ts:301 reads the same translation inventory
  // global-teardown.ts:171 compares. Protect all pre-existing keys.
  const baseline = await readLangKeyInventory(page.request);
  expect(baseline.allLangKeys).not.toContain(dataset);
  expect(await readDatasetNameKeyId(page.request, dataset)).toBeNull();
  let created = false;
  let nameKeyId: number | null = null;
  try {
    await createTempDataset(page, { datasetName: dataset,
      columns: { id: 'SERIAL', name: 'TEXT', expiry: 'DATE' },
      seedRows: [{ name: 'Tyhjä päivämäärä', expiry: null }, { name: 'Toinen tarjous', expiry: null }] });
    created = true;
    // Product source: dataset_interface_label_creator.go:65 creates this key.
    nameKeyId = await readDatasetNameKeyId(page.request, dataset);
    expect(nameKeyId).not.toBeNull();
    // The public default is modern (dataset_appearance/definition.json:27).
    // A visible empty date, as reported on Fintravel, also requires the empty
    // field gates below to be off (card_row_builder.js:239,256).
    await saveCardVisibilityWithFreshRevisions(page.request, dataset, visibility => ({
      card_style_variant: 'modern',
      columns: visibility.columns.map(column => column.column_name === 'name' || column.column_name === 'expiry' ? {
        ...column, card_element: column.column_name === 'name' ? 'header' : 'details',
        show_value_on_card: true, show_key_on_card: column.column_name === 'expiry',
        // The nullable override wins over show_key_on_card when both are sent
        // (card_label_visibility.go:52); do not retain a spread null/false.
        show_key_on_card_override: column.column_name === 'expiry',
        hide_everywhere: false, hide_on_small_card: false,
        hide_false_null_on_sml_crd: false, hide_false_null_on_big_crd: false,
      } : column),
    }));
    // Field visibility alone does not enable empty rows: the scoped appearance
    // setting filters them before any layout/printer (card_field_presentation.js:24,46).
    // Save only the disposable dataset's override, using the palette's v2 patch
    // contract (dataset_appearance_palette_state.js:36), never a site-wide change.
    const appearanceCsrf = await fetchCsrfTokenForRequest(page.request);
    const previous = (await loadDatasetCardVisibility(page.request, dataset)).dataset_appearance;
    const appearanceSave = await page.request.post('/api/admin/dataset-appearance', {
      headers: { 'X-CSRF-Token': appearanceCsrf },
      data: { schema_version: 2, dataset_uid: previous.dataset_uid, tab_set: {},
        set: { 'shared.card_show_all_fields': true }, unset: [],
        version: previous.version, shared_version: previous.shared_version },
    });
    expect(appearanceSave.ok(), await appearanceSave.text()).toBe(true);
    const savedAppearance = await appearanceSave.json() as DatasetAppearanceResponse;
    expect(savedAppearance.dataset_uid).toBe(previous.dataset_uid);
    expect(savedAppearance.overrides['shared.card_show_all_fields']).toBe(true);
    // Read persisted values afresh; an accepted POST alone is not a fixture proof.
    const configured = await loadDatasetCardVisibility(page.request, dataset);
    expect(configured.card_style_variant).toBe('modern');
    expect(configured.dataset_appearance.dataset_uid).toBe(previous.dataset_uid);
    expect(configured.dataset_appearance.overrides['shared.card_show_all_fields']).toBe(true);
    expect(configured.dataset_appearance.effective.shared.card_show_all_fields).toBe(true);
    // The card-visibility readback carries no column type; `expiry` is created as DATE above.
    expect(configured.columns.find(column => column.column_name === 'expiry')).toMatchObject({
      card_element: 'details', show_value_on_card: true,
      show_key_on_card: true, show_key_on_card_override: true,
      hide_everywhere: false, hide_on_small_card: false,
      hide_false_null_on_sml_crd: false, hide_false_null_on_big_crd: false,
    });
    await page.route('**/api/translations?*', async route => {
      const response = await route.fetch();
      const payload = await response.json();
      const language = new URL(route.request().url()).searchParams.get('lang');
      const dictionary = payload.translations || payload;
      dictionary[dataset] = language === 'fi' ? 'Matkatarjoukset' : 'Travel deals';
      dictionary.expiry = language === 'fi' ? 'Voimassa asti' : 'Expires';
      await route.fulfill({ response, json: payload });
    });
    await page.evaluate(() => localStorage.setItem('chosen_language', 'fi'));
    for (const theme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light' });
      await page.goto(`/${dataset}?view=card&sort_column=__newest&sort_order=DESC`, { waitUntil: 'domcontentloaded' });
      await waitForActiveFilterbarLayout(page);
      // Product source: translation_handler.js:403 sets html.lang in translatePage.
      await expect(page.locator('html')).toHaveAttribute('lang', 'fi');
      // Product source: translation_handler.js:316-329 caches the exact served
      // /api/translations responses used by the page, including fixture labels.
      // Existing installations keep authored copy; migration defaults are not
      // the expected text. Require both dictionaries and reject English copy.
      const payloads = await page.evaluate(async () => {
        const requests = (window as Window & {
          translationPromises?: Record<string, Promise<Record<string, unknown>>>;
        }).translationPromises;
        if (!requests?.fi || !requests.en) throw new Error('The Finnish page must load Finnish and English dictionaries');
        return { fi: await requests.fi, en: await requests.en };
      });
      // GetTranslationsHandler (lang.go:195) serves either a flat map or a
      // development envelope with translations and orphan-key metadata.
      const fi = (payloads.fi.translations || payloads.fi) as Record<string, string>;
      const en = (payloads.en.translations || payloads.en) as Record<string, string>;
      for (const key of ['sort_newest', 'sort_oldest', 'add_row_to_dataset', 'edit_fields_view', 'unknown', 'results_count_plural', dataset]) {
        for (const [language, dictionary] of [['fi', fi], ['en', en]] as const) {
          expect(dictionary[key], `${language} dictionary must serve ${key}`).toEqual(expect.any(String));
          expect(dictionary[key].trim(), `${language} dictionary must serve nonblank ${key}`).not.toBe('');
        }
        expect(fi[key], `${key} must differ from English on the Finnish page`).not.toBe(en[key]);
      }
      await page.evaluate(theme => {
        document.body.classList.remove('light-mode', 'dark-mode', 'system-mode');
        document.body.classList.add(`${theme}-mode`);
      }, theme);
      // Product source: dataset_view_printer.js:478 names the controls host;
      // active_filter_tag_printer.js:37 marks its count mirror. The two-row
      // label uses results_count_plural (results_count_printer.js:113).
      const count = page.locator(`#${dataset}_card_top_controls [data-results-count-for="${dataset}"]`).first();
      await expect(count).toHaveText(`2 ${fi.results_count_plural}`);
      await expect(count).not.toHaveText(`2 ${en.results_count_plural}`);
      await openActiveDatasetSearch(page);
      const sort = firstVisibleByTestId(page, 'sort-dropdown-trigger');
      // Product source: sort_dropdown_builder_helpers.js:47 selects __newest:DESC
      // with sort_newest; vanilla_dropdown_builder.js:384 puts its translation
      // in the input value. Compare with the page's served sort_newest copy.
      await expect(sort).toHaveValue(fi.sort_newest);
      await expect(sort).not.toHaveValue(en.sort_newest);
      await sort.click();
      // Product source: sort_dropdown_builder_helpers.js:48 offers __newest:ASC;
      // vanilla_dropdown_builder.js:9,43 turns it into option-newest-asc.
      const oldest = firstVisibleByTestId(page, 'sort-dropdown-option-newest-asc');
      await expect(oldest).toContainText(fi.sort_oldest);
      await expect(oldest).not.toContainText(en.sort_oldest);
      await sort.click();
      const tools = await revealActiveFilterbarSection(page, 'tools');
      // Product source: toolbar_button_creator.js:17-19 uses add_row_to_dataset
      // and a separate data-lang-variable-key from main_tab_lang_keys.js:26.
      // translation_handler_helpers.js:47 replaces $table_name with the served
      // dataset label. No combined add_row_<dataset> key is assumed.
      const addRow = tools.getByTestId('btn-add-row');
      await expect(addRow).toHaveText(fi.add_row_to_dataset.split('$table_name').join(fi[dataset]));
      await expect(addRow).not.toHaveText(en.add_row_to_dataset.split('$table_name').join(en[dataset]));
      // An English fallback template is also wrong with a Finnish dataset name.
      await expect(addRow).not.toHaveText(en.add_row_to_dataset.split('$table_name').join(fi[dataset]));
      // Product source: field_view_editor.js:336-338 uses btn-edit-fields-view,
      // edit_fields_view and the dictionary text.
      const editFields = tools.getByTestId('btn-edit-fields-view');
      await expect(editFields).toHaveText(fi.edit_fields_view);
      await expect(editFields).not.toHaveText(en.edit_fields_view);
      await closeActiveFilterbarIfOpen(page);
      const card = firstVisibleByTestId(page, 'card-item');
      await expect(card).toHaveAttribute('data-card-show-all-fields', 'true');
      await expect(card).toHaveAttribute('data-card-style-variant', 'modern');
      // Product source: card_row_builder.js:73 marks card-item; kv_pair_builder.js:
      // 141,174,210 names the pair variants and 152,183,219 names kv-value.
      // card_detail_single_line_helpers.js:126,166,201 and card_detail_tile_builder.js:
      // 23,70 supply the other wrappers, values and expiry label key.
      const date = card.locator('.kv-pair-conditional, .kv-pair-stacked, .kv-pair-inline, .card_detail_row_single_line, .card_detail_tile')
        .filter({ has: page.locator('[data-lang-key="expiry"]') }).locator('.kv-value, .card_detail_tile_value');
      await expect(date).toHaveCount(1);
      await expect(date).toBeVisible();
      // Product source: empty_value_printer.js:23-28 prints the dash and the
      // same unknown translation in title and aria-label.
      await expect(date).toHaveText('—');
      await expect(date).toHaveAttribute('title', fi.unknown);
      await expect(date).not.toHaveAttribute('title', en.unknown);
      await expect(date).toHaveAttribute('aria-label', fi.unknown);
      await expect(date).not.toHaveAttribute('aria-label', en.unknown);
      // Product source: card_element_builder.js:46 supplies the clickable header
      // used by openBigCard; row_article_opener.js:176 marks big-card-container.
      const listUrl = page.url();
      expect(await openBigCard(page), 'The fixture card must open its article').toBe(true);
      // Product source: row_article_ui_handler.js:112-118 creates two_line_value,
      // data-column and the same empty-value printer for the article date.
      const articleDate = page.getByTestId('big-card-container').locator('.two_line_value[data-column="expiry"]');
      await expect(articleDate).toHaveCount(1);
      await expect(articleDate).toBeVisible();
      await expect(articleDate).toHaveText('—');
      await expect(articleDate).toHaveAttribute('title', fi.unknown);
      await expect(articleDate).not.toHaveAttribute('title', en.unknown);
      await expect(articleDate).toHaveAttribute('aria-label', fi.unknown);
      await expect(articleDate).not.toHaveAttribute('aria-label', en.unknown);
      // Phone chrome deliberately hides both close buttons: shared_topbar_visibility_controller.js:
      // 102,115-117 and cards_big.css:338-340. Opening this card pushes a history
      // entry (row_article_opener.js:532-545); browser Back restores the listing
      // (history_navigation_handler.js:153-174), as in C3_close_big_card.
      if (await page.evaluate(() => window.innerWidth <= 700)) {
        await expect(page.getByTestId('shared-topbar-article-close')).toBeHidden();
        await expect(page.getByTestId('big-card-close')).toBeHidden();
        // The restored listing re-serialises its query, so the parameter order may differ;
        // compare the path and the sorted key/value pairs (JSON keeps their boundaries), not the raw string.
        const listingAddress = (url: string) => {
          const parsed = new URL(url);
          return JSON.stringify([parsed.pathname, [...parsed.searchParams].map(pair => JSON.stringify(pair)).sort()]);
        };
        expect(listingAddress(page.url())).not.toBe(listingAddress(listUrl));
        await page.goBack();
        await expect.poll(() => listingAddress(page.url())).toBe(listingAddress(listUrl));
        await expect(card).toBeVisible();
      } else {
        await closeBigCard(page);
      }
      await expect(page.locator('[data-testid="big-card-container"]:visible')).toHaveCount(0, { timeout: 5000 });
    }
  } finally {
    try {
      if (created) {
        // Product source: CleanupLangKeySourcesForTable retains keys with other
        // sources (cleanup_lang_key_sources.go:207). Even dropTempDataset may
        // therefore leave the dataset-name key the browser has also used.
        nameKeyId ??= await readDatasetNameKeyId(page.request, dataset);
        await dropTempDataset(page, dataset);
        const remainingId = await readDatasetNameKeyId(page.request, dataset);
        if (remainingId !== null) {
          expect(remainingId, 'Remove only the exact language-key row this spec created').toBe(nameKeyId);
          const csrf = await fetchCsrfTokenForRequest(page.request);
          // Product source: delete_row.go:80 accepts ids through supported CRUD.
          const deletion = await page.request.post('/api/delete-rows?dataset=system_lang_keys', {
            headers: { 'X-CSRF-Token': csrf }, data: { ids: [remainingId] },
          });
          expect(deletion.ok(), await deletion.text()).toBe(true);
          expect(await readDatasetNameKeyId(page.request, dataset)).toBeNull();
        }
      }
      // Other specs create and drop their own datasets' keys concurrently, so the complete inventory is compared once by
      // global-teardown.ts:171-194 after the whole run. Here no key of this spec's own dataset may remain.
      const ownKeys = (keys: string[]) => keys.filter(key => key.includes(dataset));
      expect(ownKeys((await readLangKeyInventory(page.request)).allLangKeys)).toEqual(ownKeys(baseline.allLangKeys));
    } finally {
      await page.evaluate(language => {
        if (language === null) localStorage.removeItem('chosen_language');
        else localStorage.setItem('chosen_language', language);
      }, originalLanguage);
    }
  }
});
