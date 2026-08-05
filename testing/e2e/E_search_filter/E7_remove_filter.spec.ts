/**
 * E7_remove_filter.spec.ts
 *
 * Tests removing an active filter via filter tag remove button.
 * Verifies interaction does not crash UI and remove control disappears.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import {
  navigateToDataset,
  waitForDataLoaded,
} from '../helpers/navigation';
import {
  closeActiveFilterbarIfOpen,
  openColumnFilterAccordion,
} from '../helpers/filterbar';
import { switchToView } from '../helpers/view-switch';

test.describe('E7 — Remove Filter', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('clicking filter tag X removes the filter', async ({ page }) => {
    await navigateToDataset(page, 'app_service_catalog');
    await waitForDataLoaded(page, 'app_service_catalog');
    await switchToView(page, 'table');

    const rows = page.locator(
      '#app_service_catalog_table_view_container [data-testid="dataset-view-table"] tbody tr',
    );
    const initialCount = await rows.count();
    expect(initialCount).toBeGreaterThan(1);

    const headerFilterRow = await openColumnFilterAccordion(
      page,
      'app_service_catalog',
      'header',
    );
    const filterInput = headerFilterRow.locator('#app_service_catalog_header');
    await expect(filterInput).toBeVisible({ timeout: 5000 });
    await expect(filterInput).toHaveValue('');

    const filterValue = 'Identity and access service';
    await filterInput.fill(filterValue);
    await filterInput.press('Enter');

    await expect(rows).toHaveCount(1, { timeout: 10000 });
    const exactActiveFilter = page
      .locator('[data-testid="active-filter-item"]:visible')
      .filter({ hasText: filterValue });
    await expect(exactActiveFilter).toHaveCount(1, { timeout: 5000 });

    await closeActiveFilterbarIfOpen(page);
    const removeBtn = exactActiveFilter.locator('[data-testid="active-filter-remove"]');
    await expect(removeBtn).toBeVisible({ timeout: 5000 });
    await removeBtn.click();

    await expect(exactActiveFilter).toHaveCount(0, { timeout: 5000 });
    await expect(rows).toHaveCount(initialCount, { timeout: 10000 });
  });
});
