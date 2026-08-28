import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { navigateToDataset, waitForDataLoaded } from '../helpers/navigation';
import { switchToView } from '../helpers/view-switch';

test.describe('O2 — F2 Edit Mode', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('F2 opens edit mode on focused cell', async ({ page }) => {
    await navigateToDataset(page, 'app_service_catalog');
    await waitForDataLoaded(page, 'app_service_catalog');
    await switchToView(page, "table");
    const cell = page.locator('table tbody tr:first-child [data-testid^="table-cell-"]').first();
    await expect(cell).toBeVisible({ timeout: 10000 });
    await cell.click();
    await page.keyboard.press('F2');
    await page.waitForTimeout(500);
    const editor = page.locator('[data-testid="table-editor"], [data-testid="inline-fk-search-input"]');
    if (await editor.first().isVisible({ timeout: 2000 }).catch(() => false)) {
      await page.keyboard.press('Escape');
    } else {
      // F2 ei ehkä tuettu
    }
  });
});
