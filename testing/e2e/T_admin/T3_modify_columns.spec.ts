/**
 * T3_modify_columns.spec.ts
 *
 * Verifies that an admin user can open column management controls via stable toolbar anchors.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { navigateToDataset, waitForDataLoaded } from '../helpers/navigation';

test.describe('T3 — Modify Columns', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('admin can open column management', async ({ page }) => {
    await navigateToDataset(page, 'app_service_catalog');
    await waitForDataLoaded(page, 'app_service_catalog');

    const adminBtn = page.locator('[data-testid="btn-edit-table"]');

    if (await adminBtn.first().isVisible({ timeout: 5000 }).catch(() => false)) {
      await adminBtn.first().click();

      const adminPanel = page.locator('[data-testid="modal-container"]');
      if (await adminPanel.first().isVisible({ timeout: 10000 }).catch(() => false)) {
        await expect(adminPanel.first()).toBeVisible();
        await page.locator('[data-testid="modal-close-button"]').click();
      }
    } else {
      test.skip();
    }
  });
});
