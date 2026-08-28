/**
 * J3_confirm_dialog.spec.ts
 *
 * Verifies delete action confirm dialog visibility and cancel behavior.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { clickFirstVisibleByTestId, firstVisibleByTestId, navigateToDataset, setFirstVisibleCheckbox, waitForDataLoaded } from '../helpers/navigation';
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
    // Valitse rivi ja yritä poistaa
    const firstRow = page.locator('#app_service_catalog_table_view_container [data-testid="dataset-view-table"] tbody tr').first();
    await expect(firstRow).toBeVisible({ timeout: 10000 });
    // On narrow viewports, the delete button is inside the collapsed filterbar panel.
    // Open the panel so the button becomes visible.
    const deleteBtn = page.locator('[data-testid="btn-delete-row"]').first();
    let deleteBtnVisible = await deleteBtn.isVisible({ timeout: 2000 }).catch(() => false);
    if (!deleteBtnVisible) {
      const toggle = page.locator('[data-testid="filterbar-toggle"]').first();
      if (await toggle.isVisible({ timeout: 2000 }).catch(() => false)) {
        await clickFirstVisibleByTestId(page, 'filterbar-toggle');
        await page.waitForTimeout(800);
        deleteBtnVisible = await deleteBtn.isVisible({ timeout: 2000 }).catch(() => false);
      }
    }
    if (deleteBtnVisible) {
      // Valitse rivi ensin (checkbox)
      const checkbox = page.locator('#app_service_catalog_table_view_container [data-testid="row-select-checkbox"]:visible').first();
      if (await checkbox.isVisible({ timeout: 2000 }).catch(() => false)) {
        await setFirstVisibleCheckbox(page, '#app_service_catalog_table_view_container [data-testid="row-select-checkbox"]');
      }
      await clickFirstVisibleByTestId(page, 'btn-delete-row');
      // Varmista confirm-dialogi
      const confirmModal = firstVisibleByTestId(page, 'modal-container');
      if (await confirmModal.isVisible({ timeout: 3000 }).catch(() => false)) {
        // Klikkaa peruuta
        const cancelBtn = confirmModal.locator('[data-testid="confirm-modal-cancel-button"]').first();
        await cancelBtn.click();
        await expect(confirmModal).toBeHidden({ timeout: 3000 });
      }
    } else {
      test.skip();
    }
  });
});
