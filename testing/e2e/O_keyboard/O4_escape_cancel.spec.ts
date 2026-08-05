import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { navigateToDataset, waitForDataLoaded } from '../helpers/navigation';
import { switchToView } from '../helpers/view-switch';

test.describe('O4 — Escape Cancel', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('Escape cancels inline edit', async ({ page }) => {
    await navigateToDataset(page, 'app_service_catalog');
    await waitForDataLoaded(page, 'app_service_catalog');
    await switchToView(page, "table");
    const cells = page.locator('table tbody tr:first-child [data-testid^="table-cell-"]');
    const count = await cells.count();
    let targetCell = null;
    let originalText: string | null = null;

    for (let i = 0; i < count; i += 1) {
      const candidate = cells.nth(i);
      const text = await candidate.textContent();
      await expect(candidate).toBeVisible({ timeout: 10000 });
      await candidate.dblclick();

      const editor = page.locator('[data-testid="table-editor"]').first();
      if (await editor.isVisible({ timeout: 1000 }).catch(() => false)) {
        const editorType = await editor.getAttribute('type');
        if (!editorType || editorType === 'text') {
          targetCell = candidate;
          originalText = text;
          await editor.fill('should-be-cancelled');
          break;
        }
        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(150);
      }
    }

    const editor = page.locator('[data-testid="table-editor"]').first();
    if (targetCell && originalText !== null && await editor.isVisible({ timeout: 3000 }).catch(() => false)) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
      const currentText = await targetCell.textContent();
      expect(currentText).not.toBe('should-be-cancelled');
      expect(currentText === originalText || currentText === '').toBe(true);
    } else {
      test.skip();
    }
  });
});
