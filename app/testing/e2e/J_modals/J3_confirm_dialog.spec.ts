/**
 * J3_confirm_dialog.spec.ts
 *
 * Verifies delete action confirm dialog visibility and cancel behavior.
 * Connects selected rows, the tools disclosure and the shared confirmation modal.
 * Keeps hidden tools from silently skipping the confirmation proof.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { navigateToDataset, setFirstVisibleCheckbox, waitForDataLoaded } from '../helpers/navigation';
import { revealActiveFilterbarSection } from '../helpers/filterbar';
import { switchToView } from '../helpers/view-switch';

test.describe('J3 — Confirm Dialog', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('confirm dialog appears and can be cancelled', async ({ page }) => {
    await navigateToDataset(page, 'app_service_catalog');
    await waitForDataLoaded(page, 'app_service_catalog');
    await switchToView(page, 'table');
    const firstRow = page.locator('#app_service_catalog_table_view_container [data-testid="dataset-view-table"] tbody tr').first();
    await expect(firstRow).toBeVisible({ timeout: 10000 });
    const checkbox = firstRow.getByTestId('row-select-checkbox');
    await expect(checkbox).toBeVisible({ timeout: 5000 });
    await setFirstVisibleCheckbox(page, '#app_service_catalog_table_view_container [data-testid="row-select-checkbox"]');
    await expect(checkbox).toBeChecked();

    // Reveal both responsive panel and nested tools without saving their layout.
    const toolsSection = await revealActiveFilterbarSection(page, 'tools');
    const deleteBtn = toolsSection.getByTestId('btn-delete-row');
    await expect(deleteBtn).toBeVisible({ timeout: 5000 });
    await deleteBtn.click();

    const confirmModal = page.getByTestId('modal-container').filter({
      has: page.getByTestId('confirm-modal-cancel-button'),
    });
    await expect(confirmModal).toBeVisible({ timeout: 5000 });
    await expect(confirmModal.getByTestId('confirm-modal-confirm-button')).toBeVisible();
    await confirmModal.getByTestId('confirm-modal-cancel-button').click();
    await expect(confirmModal).toBeHidden({ timeout: 3000 });
    await expect(firstRow).toBeVisible({ timeout: 5000 });
    await expect(checkbox).toBeChecked();
  });
});
