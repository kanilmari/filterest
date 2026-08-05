/**
 * A1_add_row.spec.ts
 *
 * Tests add-row form: opens and closes without modifying data.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { firstVisibleByTestId, navigateToDataset, openAddRowForm, waitForDataLoaded } from '../helpers/navigation';

test.describe('A1 — Add Row', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
    await navigateToDataset(page, 'app_service_catalog');
    await waitForDataLoaded(page, 'app_service_catalog');
  });

  test('opens add-row form and closes it', async ({ page }) => {
    await openAddRowForm(page);

    const modal = firstVisibleByTestId(page, 'modal-container');

    const textInput = modal
      .locator('[data-testid^="form-input-"]:is(textarea, input[type="text"], input[type="email"], input[type="search"], input[type="url"], input[type="tel"], input:not([type]))')
      .first();
    if (await textInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await textInput.fill('test-value');
    }

    const cancelBtn = firstVisibleByTestId(page, 'modal-close-button');

    if (await cancelBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await cancelBtn.click();
    } else {
      await page.keyboard.press('Escape');
    }

    await expect(modal).toBeHidden({ timeout: 5000 });
  });
});
