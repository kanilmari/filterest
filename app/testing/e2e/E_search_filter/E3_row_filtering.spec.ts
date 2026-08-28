/**
 * E3_row_filtering.spec.ts
 *
 * Tests client-side row filtering behavior on dataset view.
 * Verifies filter interaction does not break UI rendering.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import {
  navigateToDataset,
  waitForDataLoaded,
} from '../helpers/navigation';
import { openColumnFilterAccordion } from '../helpers/filterbar';
import { switchToView } from '../helpers/view-switch';

test.describe('E3 — Row Filtering', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('filter reduces visible rows', async ({ page }) => {
    await navigateToDataset(page, 'app_service_catalog');
    await waitForDataLoaded(page, 'app_service_catalog');
    await switchToView(page, 'table');

    const rows = page.locator('#app_service_catalog_table_view_container [data-testid="dataset-view-table"] tbody tr');
    await expect(rows.first()).toBeVisible({ timeout: 10000 });
    const initialCount = await rows.count();

    const headerFilterRow = await openColumnFilterAccordion(
      page,
      'app_service_catalog',
      'header',
    );
    const filterInput = headerFilterRow.locator('#app_service_catalog_header');
    await expect(filterInput).toBeVisible({ timeout: 5000 });
    await expect(filterInput).toHaveValue('');

    const filterValue = 'xyz_no_match_12345';
    await filterInput.fill(filterValue);
    await filterInput.press('Enter');

    await expect(rows).toHaveCount(0, { timeout: 10000 });
    const exactActiveFilter = page
      .locator('[data-testid="active-filter-item"]:visible')
      .filter({ hasText: filterValue });
    await expect(exactActiveFilter).toHaveCount(1, { timeout: 5000 });
    expect(initialCount).toBeGreaterThan(0);
  });
});
