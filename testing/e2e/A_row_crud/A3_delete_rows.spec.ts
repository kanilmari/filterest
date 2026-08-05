/**
 * A3_delete_rows.spec.ts
 *
 * Tests that selecting a row makes the delete button accessible.
 * Does NOT actually delete rows to preserve test data.
 *
 * On narrow viewports the delete button lives inside the filterbar panel
 * which may be collapsed.  The test opens the panel when needed so the
 * button becomes visible regardless of viewport width.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { navigateToDataset, clickFirstVisibleByTestId, setFirstVisibleCheckbox, waitForDataLoaded } from '../helpers/navigation';
import { switchToView } from '../helpers/view-switch';

test.describe('A3 — Delete Rows', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
    await navigateToDataset(page, 'app_service_catalog');
    await waitForDataLoaded(page, 'app_service_catalog');
    await switchToView(page, "table");
  });

  test('selecting a row shows delete button', async ({ page }) => {
    const firstRowCheckbox = page.locator('#app_service_catalog_table_view_container [data-testid="row-select-checkbox"]:visible').first();

    await expect(firstRowCheckbox).toBeVisible({ timeout: 10000 });
    await setFirstVisibleCheckbox(page, '#app_service_catalog_table_view_container [data-testid="row-select-checkbox"]');
    await expect(firstRowCheckbox).toBeChecked();

    // The delete button lives in the filterbar top-row.  On narrow viewports
    // the panel may be collapsed — open it so the button becomes visible.
    const deleteBtn = page.locator('[data-testid="btn-delete-row"]').first();
    const alreadyVisible = await deleteBtn.isVisible({ timeout: 2000 }).catch(() => false);

    if (!alreadyVisible) {
      const toggle = page.locator('[data-testid="filterbar-toggle"]').first();
      if (await toggle.isVisible({ timeout: 2000 }).catch(() => false)) {
        await clickFirstVisibleByTestId(page, 'filterbar-toggle');
        await page.waitForTimeout(800); // filterbar transition
      }
    }

    await expect(deleteBtn).toBeVisible({ timeout: 5000 });
  });
});
