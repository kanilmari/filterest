/**
 * A4_select_row.spec.ts
 *
 * Tests row selection toggle via checkbox.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { navigateToDataset, waitForDataLoaded } from '../helpers/navigation';
import { switchToView } from '../helpers/view-switch';

test.describe('A4 — Select Row', () => {
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

  test('row checkbox toggles selection', async ({ page }) => {
    const firstRowCheckbox = page.locator('[data-testid="row-select-checkbox"]').first();

    await expect(firstRowCheckbox).toBeVisible({ timeout: 10000 });

    // Select
    await firstRowCheckbox.check();
    await expect(firstRowCheckbox).toBeChecked();

    // Verify row or checkbox has selected state
    const firstRow = page.locator('table tbody tr').first();
    const isSelected =
      (await firstRow.getAttribute('aria-selected')) === 'true' ||
      (await firstRow.getAttribute('class'))?.includes('selected') ||
      (await firstRowCheckbox.getAttribute('aria-checked')) === 'true' ||
      (await firstRowCheckbox.isChecked());
    expect(isSelected).toBe(true);

    // Deselect
    await firstRowCheckbox.uncheck();
    await expect(firstRowCheckbox).not.toBeChecked();
  });
});
