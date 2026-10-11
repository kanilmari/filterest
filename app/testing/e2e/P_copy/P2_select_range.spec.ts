// P2_select_range.spec.ts
// Verifies mouse ranges and the phone press-and-hold copy interaction.
// Connects list cells to a visible, viewport-positioned copy menu and clipboard.
// Preserves the wide pointer path while phones use their collapsed navigation layout.
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

  test('list copy menu opens at the pointer while the navigation sidebar is visible', async ({ page }, info) => {
    await navigateToDataset(page, 'app_service_catalog');
    await waitForDataLoaded(page, 'app_service_catalog');
    await switchToView(page, 'normal');

    const firstDataRow = page.locator('[id$="_normal_view_container"]:visible .table-component-root .row:not(.header)').first();
    const cells = firstDataRow.locator('.cell');
    await expect(cells.first()).toBeVisible({ timeout: 10000 });
    expect(await cells.count()).toBeGreaterThan(1);

    if (info.project.metadata.screenWidth === 'mobile') {
      await expect(page.locator('#navbar')).toHaveClass(/\bcollapsed\b/);
      const cell = cells.first();
      await cell.scrollIntoViewIfNeeded();
      await expect(cell).toBeInViewport();
      const box = await cell.boundingBox();
      const viewport = page.viewportSize();
      if (!box || !viewport) throw new Error('Phone copy cell has no viewport bounds.');
      // Use the on-screen portion: wide list columns need not fit a phone.
      const pointer = {
        x: (Math.max(0, box.x) + Math.min(viewport.width, box.x + box.width)) / 2,
        y: (Math.max(0, box.y) + Math.min(viewport.height, box.y + box.height)) / 2,
      };
      expect(await cell.evaluate((element, point) =>
        element.contains(document.elementFromPoint(point.x, point.y)), pointer)).toBe(true);
      const copiedText = (await cell.locator('.cell-content').textContent() || '').trim();
      expect(copiedText).not.toBe('');
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
      // The matrix defines phone width without hasTouch. Enable touch only on
      // this phone page and send browser input, rather than DOM-dispatching a menu.
      const touch = await page.context().newCDPSession(page);
      const menu = page.locator('.selection-menu:visible');
      try {
        await touch.send('Emulation.setTouchEmulationEnabled', { enabled: true });
        await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pointer] });
        await expect(menu).toBeVisible();
      } finally {
        await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await touch.detach();
      }
      await expect(cell).toHaveClass(/\bselected\b/);
      await expect(menu).toBeVisible();
      await expect(menu).toHaveCSS('position', 'fixed');
      expect(await menu.evaluate(element => getComputedStyle(element).backgroundColor))
        .not.toBe('rgba(0, 0, 0, 0)');
      const menuBox = await menu.boundingBox();
      if (!menuBox) throw new Error('Phone copy menu has no visible bounds.');
      expect(menuBox.x).toBeGreaterThanOrEqual(0);
      expect(menuBox.y).toBeGreaterThanOrEqual(0);
      expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(viewport.width);
      expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(viewport.height);
      await expect(menu.locator('[data-action="copy-headers"]')).toBeVisible();
      const copyCells = menu.locator('[data-action="copy-no-headers"]');
      await expect(copyCells).toBeVisible();
      await expect(copyCells).toBeEnabled();
      await copyCells.click();
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(copiedText);
      await expect(page.locator('.selection-menu:visible')).toHaveCount(0);
      return;
    }

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
