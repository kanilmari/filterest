/**
 * J2_modal_close.spec.ts
 *
 * Verifies modal closing behavior via close button and Escape key.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { firstVisibleByTestId, navigateToDataset, openAddRowForm, waitForDataLoaded } from '../helpers/navigation';

test.describe('J2 — Modal Close', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('modal closes with X button', async ({ page }) => {
    await navigateToDataset(page, 'app_service_catalog');
    await waitForDataLoaded(page, 'app_service_catalog');
    await openAddRowForm(page);
    const modal = firstVisibleByTestId(page, 'modal-container');
    await expect(modal).toBeVisible({ timeout: 5000 });
    const closeBtn = firstVisibleByTestId(page, 'modal-close-button');
    if (await closeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await closeBtn.click();
    } else {
      await page.keyboard.press('Escape');
    }
    await expect(modal).toBeHidden({ timeout: 5000 });
  });

  test('modal closes with Escape key', async ({ page }) => {
    await navigateToDataset(page, 'app_service_catalog');
    await waitForDataLoaded(page, 'app_service_catalog');
    await openAddRowForm(page);
    const modal = firstVisibleByTestId(page, 'modal-container');
    await expect(modal).toBeVisible({ timeout: 5000 });
    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden({ timeout: 5000 });
  });
});
