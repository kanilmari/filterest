/**
 * S2_permission_check_action.spec.ts
 *
 * Verifies that disabled controls do not trigger actions in the app_service_catalog dataset.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { navigateToDataset, waitForDataLoaded } from '../helpers/navigation';

test.describe('S2 — Permission Check Action', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('disabled elements are not clickable', async ({ page }) => {
    await navigateToDataset(page, 'app_service_catalog');
    await waitForDataLoaded(page, 'app_service_catalog');

    const disabledElements = page.locator('[disabled], .disabled, button:disabled');
    const count = await disabledElements.count();

    if (count > 0) {
      const firstDisabled = disabledElements.first();
      await expect(firstDisabled).toBeVisible();

      // Count modals before click — clicking disabled elements must not open new modals.
      // Note: "access denied" toasts are expected and legitimate, so we only assert on modals.
      const visibleModals = page.locator('#custom_modal:visible, .modal:visible, [role="dialog"]:visible');
      const modalCountBefore = await visibleModals.count();

      await firstDisabled.click({ timeout: 1000 }).catch(() => {
        // Disabled elements often reject click actions; this is acceptable.
      });
      await page.waitForTimeout(300);

      await expect(visibleModals).toHaveCount(modalCountBefore);
    } else {
      test.skip();
    }
  });
});
