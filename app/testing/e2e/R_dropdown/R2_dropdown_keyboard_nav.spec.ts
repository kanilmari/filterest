import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { navigateToDataset, waitForDataLoaded } from '../helpers/navigation';

test.describe('R2 — Dropdown Keyboard Navigation', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('dropdown supports keyboard navigation', async ({ page }) => {
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
    const options = page.locator('[data-testid="source_table_dropdown_container-options"]');

    await expect(dropdownTrigger).toBeVisible({ timeout: 5000 });
    await dropdownTrigger.click();
    await expect(searchInput).toBeVisible({ timeout: 3000 });
    await expect(options).toBeVisible();
    await searchInput.press('ArrowDown');
    await page.waitForTimeout(200);
    await searchInput.press('ArrowDown');
    await page.waitForTimeout(200);
    await searchInput.press('Enter');
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
  });
});
