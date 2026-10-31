// P4_table_second_batch_row_index.spec.ts
// Proves appended table rows retain their own selection, copy, navigation and delete identity.
// Bridges the real infinite-scroll renderer with clipboard and row-delete requests.
// Uses registered temporary datasets and request-scoped cleanup even after browser failures.

import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { login, loadCredentials } from '../helpers/auth';
import { closeActiveFilterbarIfOpen, revealActiveFilterbarSection, waitForActiveFilterbarLayout } from '../helpers/filterbar';
import { scrollActiveContentToBottom } from '../helpers/scroll';
import { listRegisteredTestArtifacts } from '../helpers/test-artifact-run-registry';
import { buildTempDatasetName, cleanupDatasetViaRequest, createTempDataset } from '../helpers/temp-dataset';

async function cleanupRegisteredDataset(request: APIRequestContext, dataset: string) {
  const artifact = listRegisteredTestArtifacts().find(item => item.kind === 'dataset' && item.name === dataset);
  if (!artifact) return;
  if (artifact.status !== 'confirmed') {
    throw new Error(`Dataset creation has unconfirmed ownership: ${dataset}; retained for registered-run recovery.`);
  }
  await cleanupDatasetViaRequest(request, dataset);
}

async function expectClipboard(page: Page, text: string) {
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText()), { timeout: 5_000 }).toBe(text);
}

test.describe('P4 — Table coordinates across infinite-scroll batches', () => {
  let dataset = '';

  // A fresh teardown budget also covers a test timeout or a closed page.
  test.afterEach(async ({ page }) => {
    test.setTimeout(35_000);
    if (dataset) await cleanupRegisteredDataset(page.request, dataset);
    dataset = '';
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`second-batch copy, keyboard navigation and delete use row 9 (${theme})`, async ({ page }, info) => {
      test.skip(info.project.name !== 'desktop-card', 'The row-index copy logic does not depend on the device (K527, test freeze).');
      test.setTimeout(180_000);
      dataset = buildTempDatasetName('e2e_table_batch_coordinates');
      let primaryError: unknown;
      try {
        await login(page, loadCredentials());
        const config = await page.request.get('/api/get-results', {
          params: { dataset: 'system_config', view_key: 'table', key: 'results_load_amount' },
        });
        expect(config.ok()).toBe(true);
        expect(Number((await config.json()).resultsPerLoad), 'This 30-row regression requires batches of 20.').toBe(20);
        await createTempDataset(page, {
          datasetName: dataset,
          columns: { id: 'SERIAL', label: 'TEXT', hidden_middle: 'TEXT', right_column: 'TEXT' },
          seedRows: Array.from({ length: 30 }, (_, index) => ({
            label: `row-${index + 1}`, hidden_middle: `HIDDEN-${index + 1}`, right_column: `right-${index + 1}`,
          })),
        });
        await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light' });
        await page.evaluate(() => localStorage.setItem('chosen_language', 'fi'));
        const firstResponse = page.waitForResponse(response => {
          const url = new URL(response.url());
          return url.pathname === '/api/get-results' && url.searchParams.get('dataset') === dataset
            && url.searchParams.get('view_key') === 'table' && Number(url.searchParams.get('offset') || 0) === 0;
        });
        // A fresh temporary dataset need not have a top navigation tab.
        await page.goto(`/${dataset}?view=table&sort_column=id&sort_order=DESC`, { waitUntil: 'domcontentloaded' });
        const response = await firstResponse;
        expect(response.ok()).toBe(true);
        const firstBatch = await response.json() as { data: Array<{ id: number }>; row_count: number };
        expect(firstBatch.data.map(row => row.id)).toEqual(Array.from({ length: 20 }, (_, index) => 30 - index));
        expect(firstBatch.row_count).toBe(30);
        const root = page.locator(`#${dataset}_table_view_container`);
        const table = root.getByTestId('dataset-view-table');
        await expect(table).toBeVisible();
        await expect(page.locator('html')).toHaveAttribute('lang', 'fi');
        await waitForActiveFilterbarLayout(page);
        await closeActiveFilterbarIfOpen(page);
        await page.evaluate(theme => {
          document.body.classList.remove('light-mode', 'dark-mode', 'system-mode');
          document.body.classList.add(`${theme}-mode`);
        }, theme);
        await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}-mode\\b`));
        const rows = table.locator('tbody tr[data-row-id]');
        await expect.poll(async () => {
          await scrollActiveContentToBottom(page);
          return rows.count();
        }, { timeout: 20_000 }).toBe(30);
        await expect(rows.nth(21)).toHaveAttribute('data-row-id', '9');
        const coordinates = await table.locator('td.table_data_cell').evaluateAll(cells => cells.map(cell =>
          `${(cell as HTMLElement).dataset.rowIndex}:${(cell as HTMLElement).dataset.colIndex}`));
        expect(new Set(coordinates).size).toBe(coordinates.length);
        const cell = (id: number) => table.locator(`tr[data-row-id="${id}"] td[data-column="label"]`);
        const target = cell(9);
        await expect(target).toHaveText('row-9');
        await expect(target).toHaveAttribute('data-row-index', '21');
        await target.click();
        await expect(table.locator('td.table_data_cell.selected')).toHaveCount(1);
        await expect(table.locator('td.table_data_cell.selected_for_editing')).toHaveCount(1);
        await expect(target).toHaveClass(/\bselected\b/);
        await expect(target).toHaveClass(/\bselected_for_editing\b/);
        await expect(target).toBeFocused();

        await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
        const menuMarker = `menu-${dataset}`;
        await page.evaluate(marker => navigator.clipboard.writeText(marker), menuMarker);
        await expectClipboard(page, menuMarker);
        await target.click({ button: 'right' });
        const menu = page.locator('.selection-menu:visible');
        await expect(menu).toBeVisible();
        await menu.locator('[data-action="copy-no-headers"]').click();
        await expectClipboard(page, 'row-9');
        await expect(menu).toBeHidden();

        const keyboardMarker = `keyboard-${dataset}`;
        await page.evaluate(marker => navigator.clipboard.writeText(marker), keyboardMarker);
        await expectClipboard(page, keyboardMarker);
        await target.click();
        await page.keyboard.press('Control+c');
        await expectClipboard(page, 'row-9');

        // Use the product's column toggle: the hidden cells must remain in the DOM.
        const filters = await revealActiveFilterbarSection(page, 'filters');
        await filters.locator('[data-testid^="column-visibility-toggle-"][data-testid$="-hidden_middle"]').uncheck();
        await closeActiveFilterbarIfOpen(page);
        const hidden = table.locator('tr[data-row-id="9"] td[data-column="hidden_middle"]');
        const right = table.locator('tr[data-row-id="9"] td[data-column="right_column"]');
        await expect(hidden).toHaveCount(1);
        await expect(hidden).toBeHidden();
        await expect(right).toBeVisible();
        expect(Number(await hidden.getAttribute('data-col-index'))).toBeGreaterThan(Number(await target.getAttribute('data-col-index')));
        expect(Number(await hidden.getAttribute('data-col-index'))).toBeLessThan(Number(await right.getAttribute('data-col-index')));
        await target.click();
        await right.click({ modifiers: ['Shift'] });
        for (const withHeaders of [false, true]) {
          await right.click({ button: 'right' });
          await expect(menu).toBeVisible();
          await menu.locator(`[data-action="${withHeaders ? 'copy-headers' : 'copy-no-headers'}"]`).click();
          await expectClipboard(page, `${withHeaders ? 'label\tright_column\n' : ''}row-9\tright-9`);
        }
        await target.click();
        await right.click({ modifiers: ['Shift'] });
        await page.keyboard.press('Control+c');
        await expectClipboard(page, 'row-9\tright-9');
        await target.click();
        await page.keyboard.press('ArrowDown');
        await expect(cell(8)).toBeFocused();
        await expect(cell(8)).toHaveClass(/\bselected_for_editing\b/);
        // Crossing the first/second batch boundary is a separate navigation case.
        await cell(11).click();
        await page.keyboard.press('ArrowDown');
        await expect(cell(10)).toBeFocused();

        await target.locator('..').getByTestId('row-select-checkbox').check();
        const tools = await revealActiveFilterbarSection(page, 'tools');
        await tools.getByTestId('btn-delete-row').click();
        const confirm = page.getByTestId('modal-container').filter({
          has: page.getByTestId('confirm-modal-confirm-button'),
        });
        await expect(confirm).toBeVisible();
        const deletion = page.waitForResponse(response => {
          const url = new URL(response.url());
          return response.request().method() === 'POST' && url.pathname === '/api/delete-rows'
            && url.searchParams.get('dataset') === dataset;
        });
        await confirm.getByTestId('confirm-modal-confirm-button').click();
        const deleted = await deletion;
        expect(deleted.request().postDataJSON()).toEqual({ ids: [9] });
        expect(deleted.ok()).toBe(true);
        await expect(table.locator('tr[data-row-id="9"]')).toHaveCount(0);
        await expect(cell(29)).toHaveText('row-29');
      } catch (error) {
        primaryError = error;
        throw error;
      } finally {
        try {
          await cleanupRegisteredDataset(page.request, dataset);
        } catch (cleanupError) {
          if (primaryError) throw new AggregateError([primaryError, cleanupError], 'Regression and dataset cleanup both failed.');
          throw cleanupError;
        }
      }
    });
  }
});
