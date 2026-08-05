import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { navigateToDataset, waitForDataLoaded } from '../helpers/navigation';
import { switchToView } from '../helpers/view-switch';

test.describe('FX — Sort Dropdown', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('sort dropdown changes data order', async ({ page }) => {
    await navigateToDataset(page, 'app_service_catalog');
    await waitForDataLoaded(page, 'app_service_catalog');
    await switchToView(page, "table");

    const sortBtn = page.locator('[data-testid="sort-dropdown-trigger"]:visible').first();
    await expect(sortBtn).toBeVisible({ timeout: 5000 });
    await sortBtn.click();

    const sortOption = page
      .locator('[data-testid="sort-dropdown-option-created-desc"]:visible')
      .first();
    await expect(sortOption).toBeVisible({ timeout: 3000 });
    await sortOption.click();

    await expect(sortBtn).toHaveAttribute('data-lang-key', 'sort_newest', { timeout: 5000 });
    await expect(
      page.locator(
        '#app_service_catalog_table_view_container [data-testid="column-sort-created"]',
      ),
    ).toHaveText('▼', { timeout: 10000 });
    await expect(
      page.locator(
        '#app_service_catalog_table_view_container [data-testid="dataset-view-table"] tbody tr',
      ).first(),
    ).toBeVisible({ timeout: 10000 });
  });
});
