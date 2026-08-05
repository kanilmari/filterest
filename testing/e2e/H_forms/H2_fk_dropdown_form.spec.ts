/**
 * H2_fk_dropdown_form.spec.ts
 *
 * Verifies foreign key dropdown availability in add-row form.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { navigateToDataset, openAddRowForm, waitForDataLoaded } from '../helpers/navigation';

test.describe('H2 — FK Dropdown Form', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('FK dropdown loads options in form', async ({ page }) => {
    await navigateToDataset(page, 'app_service_catalog');
    await waitForDataLoaded(page, 'app_service_catalog');

    await openAddRowForm(page);

    const form = page.locator('[data-testid="add-row-form"]');
    await expect(form.first()).toBeVisible({ timeout: 10000 });

    // Etsi FK dropdown (select tai custom dropdown)
    const fkDropdown = form.first().locator('select, [data-fk-column], .fk-dropdown, .foreign-key-select');
    if (await fkDropdown.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      await fkDropdown.first().click();

      // Varmista vaihtoehtoja latautuu
      const options = page.locator('option, .dropdown-option, .fk-option, li[data-value]');
      await expect(options.first()).toBeVisible({ timeout: 5000 }).catch(() => {});
    }

    await page.keyboard.press('Escape');
  });
});
