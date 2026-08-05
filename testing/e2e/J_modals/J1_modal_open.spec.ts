/**
 * J1_modal_open.spec.ts
 *
 * Verifies that add-row action opens a modal dialog.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { firstVisibleByTestId, navigateToDataset, openAddRowForm, waitForDataLoaded } from '../helpers/navigation';

test.describe('J1 — Modal Open', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('modal opens when triggered', async ({ page }) => {
    await navigateToDataset(page, 'app_service_catalog');
    await waitForDataLoaded(page, 'app_service_catalog');
    await openAddRowForm(page);
    const modal = firstVisibleByTestId(page, 'modal-container');
    await expect(modal).toBeVisible({ timeout: 5000 });
    await page.keyboard.press('Escape');
  });
});
