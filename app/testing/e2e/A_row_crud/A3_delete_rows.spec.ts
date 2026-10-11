/**
 * A3_delete_rows.spec.ts
 *
 * Tests Delete availability after selection and deletion of a temporary row.
 * Bridges row selection, the tools disclosure and the confirmation workflow.
 * Preserves shared rows and saved layout while proving real deletion.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { navigateToDataset, setFirstVisibleCheckbox, waitForDataLoaded } from '../helpers/navigation';
import { revealActiveFilterbarSection } from '../helpers/filterbar';
import {
  buildTempDatasetName,
  createTempDataset,
  dropTempDataset,
  openTempDataset,
} from '../helpers/temp-dataset';
import { switchToView } from '../helpers/view-switch';

test.describe('A3 — Delete Rows', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('selecting a row shows delete button', async ({ page }) => {
    await navigateToDataset(page, 'app_service_catalog');
    await waitForDataLoaded(page, 'app_service_catalog');
    await switchToView(page, 'table');

    const firstRowCheckbox = page.locator('#app_service_catalog_table_view_container [data-testid="row-select-checkbox"]:visible').first();

    await expect(firstRowCheckbox).toBeVisible({ timeout: 10000 });
    await setFirstVisibleCheckbox(page, '#app_service_catalog_table_view_container [data-testid="row-select-checkbox"]');
    await expect(firstRowCheckbox).toBeChecked();

    // The tools disclosure is collapsed by default on every viewport.
    const toolsSection = await revealActiveFilterbarSection(page, 'tools');
    const deleteBtn = toolsSection.getByTestId('btn-delete-row');
    await expect(deleteBtn).toBeVisible({ timeout: 5000 });
  });

  test('deleting a selected row preserves unselected rows', async ({ page }) => {
    const datasetName = buildTempDatasetName('e2e_delete_rows');
    await createTempDataset(page, {
      datasetName,
      columns: { id: 'SERIAL', title: 'TEXT' },
      seedRows: [{ title: 'Row to delete' }, { title: 'Row to keep' }],
    });

    try {
      await openTempDataset(page, datasetName, 'table');
      const rows = page.locator(`#${datasetName}_table_view_container tbody tr`);
      const selectedRow = rows.filter({ hasText: 'Row to delete' });
      const retainedRow = rows.filter({ hasText: 'Row to keep' });
      await expect(selectedRow).toBeVisible({ timeout: 10000 });
      await expect(retainedRow).toBeVisible({ timeout: 10000 });
      const checkbox = selectedRow.getByTestId('row-select-checkbox');
      await checkbox.check();
      await expect(checkbox).toBeChecked();
      await expect(retainedRow.getByTestId('row-select-checkbox')).not.toBeChecked();

      const toolsSection = await revealActiveFilterbarSection(page, 'tools');
      const deleteBtn = toolsSection.getByTestId('btn-delete-row');
      await expect(deleteBtn).toBeVisible({ timeout: 5000 });
      await deleteBtn.click();

      const confirmModal = page.getByTestId('modal-container').filter({
        has: page.getByTestId('confirm-modal-confirm-button'),
      });
      await expect(confirmModal).toBeVisible({ timeout: 5000 });
      await confirmModal.getByTestId('confirm-modal-confirm-button').click();
      await expect(confirmModal).toBeHidden({ timeout: 10000 });
      await expect(selectedRow).toHaveCount(0, { timeout: 10000 });
      await expect(retainedRow).toBeVisible({ timeout: 10000 });
    } finally {
      if (!page.isClosed()) {
        await dropTempDataset(page, datasetName);
      }
    }
  });
});
