import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { navigateToDataset, waitForDataLoaded } from '../helpers/navigation';

test.describe('R1 — Dropdown Open Search Select', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('vanilla dropdown opens, searches, and selects', async ({ page }) => {
    await navigateToDataset(page, 'app_service_catalog');
    await waitForDataLoaded(page, 'app_service_catalog');

    const triggerManagementButton = page.locator('[data-testid="admin-tree-btn-add_notification_trigger"]');
    await expect(triggerManagementButton).toHaveCount(1, { timeout: 5000 });
    await page.evaluate(() => {
      const button = document.querySelector('[data-testid="admin-tree-btn-add_notification_trigger"]');
      if (button instanceof HTMLElement) {
        button.click();
      }
    });

    const dropdownTrigger = page.locator('[data-testid="source_table_dropdown_container-trigger"]');
    const searchInput = page.locator('[data-testid="source_table_dropdown_container-search-input"]');
    const option = page.locator('[data-testid="source_table_dropdown_container-option-app-service-catalog"]');

    await expect(dropdownTrigger).toBeVisible({ timeout: 5000 });
    await dropdownTrigger.click();
    await expect(searchInput).toBeVisible({ timeout: 3000 });
    await searchInput.fill('service');
    await expect(option).toBeVisible({ timeout: 3000 });
    await option.click();
    await expect(dropdownTrigger).toHaveValue('app_service_catalog');
  });
});
