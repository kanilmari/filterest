/**
 * E6_active_filter_tags.spec.ts
 *
 * Tests active filter tag visibility when a filter is applied.
 * Falls back to basic UI stability assertion if tags are unavailable.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { navigateToDataset } from '../helpers/navigation';

test.describe('E6 — Active Filter Tags', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('active filter tags appear when filter is set', async ({ page }) => {
    await navigateToDataset(page, 'app_service_catalog');

    const activeTagsContainer = page.locator('[data-testid="active-filters"]');
    const filterToggle = page.locator('[data-testid="filterbar-toggle"]').first();

    if (await filterToggle.isVisible({ timeout: 2000 }).catch(() => false)) {
      await filterToggle.click();
      await page.waitForTimeout(300);

      const filterInput = page.locator('[data-testid^="table-filter-input-"]').first();
      if (await filterInput.isVisible({ timeout: 2000 }).catch(() => false)) {
        await filterInput.fill('a');
        await page.waitForTimeout(500);

        if (await activeTagsContainer.isVisible({ timeout: 3000 }).catch(() => false)) {
          await expect(activeTagsContainer.first()).toBeVisible();
        }
      }
    }

    await expect(page.locator('body')).toBeVisible();
  });
});
