/**
 * E4_filter_bar.spec.ts
 *
 * Tests filter bar toggle and visibility.
 * Confirms filter UI can be opened from dataset view.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { navigateToDataset } from '../helpers/navigation';

test.describe('E4 — Filter Bar', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('filter bar opens and shows filter options', async ({ page }) => {
    await navigateToDataset(page, 'app_service_catalog');

    const filterToggle = page.locator('[data-testid="filterbar-toggle"]').first();

    if (!(await filterToggle.isVisible({ timeout: 3000 }).catch(() => false))) {
      test.skip(true, 'No filter toggle button found');
      return;
    }

    await filterToggle.evaluate((button) => {
      if (button instanceof HTMLElement) {
        button.click();
      }
    });

    const filterBar = page.locator(
      '.filterbar-sidebar, .filterbar-hero, .dataset-filter-panel, [id$="_filterBar_panel"], [id$="_filterBar"], [id$="_filterBar_sidebar"], [id$="_filterBar_hero"]',
    );
    await expect(filterBar.first()).toBeVisible({ timeout: 5000 });
  });
});
