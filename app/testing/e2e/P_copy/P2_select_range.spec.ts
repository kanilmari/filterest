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

  test('list copy menu opens at the pointer while the navigation sidebar is visible', async ({ page }) => {
    await navigateToDataset(page, 'app_service_catalog');
    await waitForDataLoaded(page, 'app_service_catalog');
    await switchToView(page, 'normal');

    const firstDataRow = page.locator('[id$="_normal_view_container"]:visible .table-component-root .row:not(.header)').first();
    const cells = firstDataRow.locator('.cell');
    await expect(cells.first()).toBeVisible({ timeout: 10000 });
    expect(await cells.count()).toBeGreaterThan(1);

    const firstBox = await cells.nth(0).boundingBox();
    const secondBox = await cells.nth(1).boundingBox();
    expect(firstBox).not.toBeNull();
    expect(secondBox).not.toBeNull();
    await page.mouse.move((firstBox?.x ?? 0) + 8, (firstBox?.y ?? 0) + 8);
    await page.mouse.down();
    await page.mouse.move((secondBox?.x ?? 0) + 8, (secondBox?.y ?? 0) + 8, { steps: 3 });
    await page.mouse.up();

    const pointer = {
      x: (firstBox?.x ?? 0) + 16,
      y: (firstBox?.y ?? 0) + 16,
    };
    await page.mouse.click(pointer.x, pointer.y, { button: 'right' });
    const menu = page.locator('.selection-menu:visible');
    await expect(menu).toBeVisible();
    const menuBox = await menu.boundingBox();
    expect(Math.abs((menuBox?.x ?? 0) - pointer.x)).toBeLessThan(3);
    expect(Math.abs((menuBox?.y ?? 0) - pointer.y)).toBeLessThan(3);
    await expect(menu).toHaveCSS('position', 'fixed');
    expect(await menu.evaluate((element) => getComputedStyle(element).backgroundColor))
      .not.toBe('rgba(0, 0, 0, 0)');
  });
});
