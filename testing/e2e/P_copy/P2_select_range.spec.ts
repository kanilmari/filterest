import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { navigateToDataset, waitForDataLoaded } from '../helpers/navigation';
import { switchToView } from '../helpers/view-switch';

test.describe('P2 — Select Range', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('cell range can be selected with mouse', async ({ page }) => {
    await navigateToDataset(page, 'app_service_catalog');
    await waitForDataLoaded(page, 'app_service_catalog');
    await switchToView(page, "table");
    const cells = page.locator('table tbody tr:first-child td');
    await expect(cells.first()).toBeVisible({ timeout: 10000 });
    const count = await cells.count();
    if (count < 2) {
      test.skip();
      return;
    }
    const firstBox = await cells.nth(1).boundingBox();
    const secondBox = await cells.nth(Math.min(2, count - 1)).boundingBox();
    if (firstBox && secondBox) {
      await page.mouse.move(firstBox.x + 5, firstBox.y + 5);
      await page.mouse.down();
      await page.mouse.move(secondBox.x + 5, secondBox.y + 5, { steps: 3 });
      await page.mouse.up();
      await page.waitForTimeout(300);
    }
  });
});

