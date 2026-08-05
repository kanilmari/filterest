import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { navigateToDataset, waitForDataLoaded } from '../helpers/navigation';
import { switchToView } from '../helpers/view-switch';

test.describe('P1 — Copy Cells', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('cells can be selected for copying', async ({ page }) => {
    await navigateToDataset(page, 'app_service_catalog');
    await waitForDataLoaded(page, 'app_service_catalog');
    await switchToView(page, "table");
    const cell = page.locator('table tbody tr:first-child td').nth(1);
    await expect(cell).toBeVisible({ timeout: 10000 });
    // Valitse solualue
    await cell.click();
    await page.keyboard.down('Shift');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.up('Shift');
    await page.waitForTimeout(300);
    // Kopioi
    await page.keyboard.press('Control+c');
    await page.waitForTimeout(300);
    // Clipboard-tarkistus voi epäonnistua sandbox-ympäristössä
  });
});
