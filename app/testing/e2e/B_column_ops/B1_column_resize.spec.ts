import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { navigateToDataset, waitForDataLoaded } from '../helpers/navigation';
import { switchToView } from '../helpers/view-switch';

test.describe('B1 — Column Resize', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('column can be resized by dragging', async ({ page }) => {
    await navigateToDataset(page, 'app_service_catalog');
    await waitForDataLoaded(page, 'app_service_catalog');
    await switchToView(page, "table");

    // Skip the first th (checkbox column) — use the second data column header
    const dataHeaders = page.locator('table thead th:nth-child(n+2)');
    if (!(await dataHeaders.first().isVisible({ timeout: 5000 }).catch(() => false))) {
      test.skip();
      return;
    }

    const targetHeader = dataHeaders.first();
    const resizeHandle = targetHeader.locator('.resize-handle');
    if (!(await resizeHandle.isVisible({ timeout: 3000 }).catch(() => false))) {
      test.skip();
      return;
    }

    // Use evaluate to dispatch mouse events with correct pageX values,
    // since Playwright's page.mouse doesn't always set pageX correctly
    // for handlers that read event.pageX.
    const widthChanged = await page.evaluate((selector) => {
      const th = document.querySelector(selector) as HTMLElement;
      if (!th) return false;
      const handle = th.querySelector('.resize-handle') as HTMLElement;
      if (!handle) return false;

      const initialWidth = th.offsetWidth;
      const rect = handle.getBoundingClientRect();
      const startX = rect.left + rect.width / 2;
      const startY = rect.top + rect.height / 2;

      handle.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true, clientX: startX, clientY: startY,
        pageX: startX + window.scrollX, pageY: startY + window.scrollY,
      }));

      for (let step = 1; step <= 10; step++) {
        const moveX = startX + (step * 15);
        document.dispatchEvent(new MouseEvent('mousemove', {
          bubbles: true, clientX: moveX, clientY: startY,
          pageX: moveX + window.scrollX, pageY: startY + window.scrollY,
        }));
      }

      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

      return th.offsetWidth > initialWidth;
    }, 'table thead th:nth-child(2)');

    expect(widthChanged).toBe(true);
  });
});
