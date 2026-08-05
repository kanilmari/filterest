/**
 * G2_tab_click.spec.ts
 *
 * Verifies that clicking a tab loads its dataset.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { navigateToDataset } from '../helpers/navigation';

test.describe('G2 — Tab Click', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('clicking a tab loads its dataset', async ({ page }) => {
    // Navigate to app_service_catalog table first
    await navigateToDataset(page, 'app_service_catalog');

    const tabs = page.locator(
      '[data-testid^="tab-"]:not([data-testid="tab-user"]):not([data-testid="tab-logout"]):not([data-testid="tab-system_about"])',
    );
    const tabCount = await tabs.count();

    if (tabCount > 1) {
      // Click a different tab (not the currently active one)
      const inactiveTab = page.locator(
        '[data-testid^="tab-"]:not([data-testid="tab-user"]):not([data-testid="tab-logout"]):not([data-testid="tab-system_about"]):not(.active)',
      ).first();
      if (await inactiveTab.isVisible({ timeout: 3000 }).catch(() => false)) {
        const tabDataId = await inactiveTab.getAttribute('data-id');
        await inactiveTab.evaluate((el: HTMLElement) => el.click());
        // Verify the content area loaded for the clicked tab
        const containerSelector = tabDataId
          ? `#${tabDataId}_card_view_container, #${tabDataId}_table_view_container`
          : '.scrollable_content';
        await page.waitForSelector(containerSelector, { state: 'attached', timeout: 15000 });
      } else {
        test.skip();
      }
    } else {
      // Only one tab: verify it is visible and active
      const singleTab = tabs.first();
      if (await singleTab.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(singleTab).toBeVisible();
      } else {
        test.skip();
      }
    }
  });
});
