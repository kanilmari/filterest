/**
 * A8_temp_dataset_persistence.spec.ts
 *
 * Verifies create and delete persistence on a throwaway dataset.
 * Bridges the UI row CRUD flow and a temporary dataset lifecycle.
 * Exists to test real add/delete behavior without mutating shared datasets.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { clickFirstVisibleByTestId, openAddRowForm, setFirstVisibleCheckbox } from '../helpers/navigation';
import {
  buildTempDatasetName,
  createTempDataset,
  dropTempDataset,
  openTempDataset,
} from '../helpers/temp-dataset';

test.describe('A8 — Temporary Dataset Row Persistence', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('row creation persists after reload and row deletion persists after reload', async ({ page }) => {
    const datasetName = buildTempDatasetName('e2e_row_persistence');
    const rowName = `Persistent row ${Date.now().toString(36)}`;

    await createTempDataset(page, {
      datasetName,
      columns: {
        id: 'SERIAL',
        name: 'TEXT',
        type: 'TEXT',
        description: 'TEXT',
        parent_id: 'INTEGER',
      },
    });

    try {
      await openTempDataset(page, datasetName, 'table');
      await openAddRowForm(page);

      const modal = page.locator('[data-testid="modal-container"]').first();
      await expect(modal).toBeVisible({ timeout: 10000 });
      const addRowForm = modal.locator('[data-testid="add-row-form"]').first();
      await addRowForm.locator('[data-testid="form-input-name"]').first().fill(rowName);
      await addRowForm.locator('[data-testid="form-input-type"]').first().fill('item');
      await addRowForm
        .locator('[data-testid="form-input-description"]')
        .first()
        .fill('Created by A8 temp dataset test');
      await addRowForm.locator('[data-testid="btn-add-row-submit"]').first().click();
      await expect(modal).toBeHidden({ timeout: 10000 });

      const createdRow = page.locator(
        `#${datasetName}_container tbody tr, #${datasetName}_table_view_container tbody tr`,
      ).filter({ hasText: rowName }).first();
      await expect(createdRow).toBeVisible({ timeout: 10000 });

      await openTempDataset(page, datasetName, 'table');

      const persistedRow = page.locator(
        `#${datasetName}_container tbody tr, #${datasetName}_table_view_container tbody tr`,
      ).filter({ hasText: rowName }).first();
      await expect(persistedRow).toBeVisible({ timeout: 10000 });

      await setFirstVisibleCheckbox(
        page,
        `#${datasetName}_container [data-testid="row-select-checkbox"], #${datasetName}_table_view_container [data-testid="row-select-checkbox"]`,
      );
      const deleteButton = page.locator(
        `#${datasetName}_container [data-testid="btn-delete-row"], #${datasetName}_table_view_container [data-testid="btn-delete-row"]`,
      ).first();
      const deleteButtonVisible = await deleteButton.isVisible({ timeout: 2000 }).catch(() => false);
      if (!deleteButtonVisible) {
        const toggle = page.locator('[data-testid="filterbar-toggle"]').first();
        if (await toggle.isVisible({ timeout: 2000 }).catch(() => false)) {
          await clickFirstVisibleByTestId(page, 'filterbar-toggle');
          await page.waitForTimeout(800);
        }
      }
      await expect(deleteButton).toBeVisible({ timeout: 5000 });
      await clickFirstVisibleByTestId(page, 'btn-delete-row');

      const confirmModal = page.locator('[data-testid="modal-container"]').first();
      await expect(confirmModal).toBeVisible({ timeout: 5000 });
      await confirmModal.locator('[data-testid="confirm-modal-confirm-button"]').click();

      await expect(page.locator(
        `#${datasetName}_container tbody tr, #${datasetName}_table_view_container tbody tr`,
      ).filter({ hasText: rowName })).toHaveCount(0, {
        timeout: 10000,
      });

      await openTempDataset(page, datasetName, 'table');
      await expect(page.locator(
        `#${datasetName}_container tbody tr, #${datasetName}_table_view_container tbody tr`,
      ).filter({ hasText: rowName })).toHaveCount(0, {
        timeout: 10000,
      });
    } finally {
      if (!page.isClosed()) {
        await dropTempDataset(page, datasetName);
      }
    }
  });
});
