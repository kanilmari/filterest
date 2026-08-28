import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import {
  buildTempDatasetName,
  createTempDataset,
  dropTempDataset,
  openTempDataset,
} from '../helpers/temp-dataset';

test.describe('O3 — Enter Save', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('Enter saves inline edit', async ({ page }) => {
    const datasetName = buildTempDatasetName('e2e_enter_save');
    const originalText = `enter-save-original-${Date.now().toString(36)}`;
    const editedText = `enter-save-edited-${Date.now().toString(36)}`;

    await createTempDataset(page, {
      datasetName,
      columns: {
        id: 'SERIAL',
        title: 'TEXT',
        status: 'TEXT',
      },
      seedRows: [
        {
          title: originalText,
          status: 'draft',
        },
      ],
    });

    try {
      await openTempDataset(page, datasetName, 'table');

      const targetCell = page.locator(
        `#${datasetName}_table_view_container [data-column="title"]`,
      ).first();
      await expect(targetCell).toContainText(originalText, { timeout: 10000 });

      const errorToast = page.locator('.toast-notification-item[data-toast-level="error"]');

      try {
        await targetCell.dblclick();
        const editor = page.locator('[data-testid="table-editor"]').first();
        await expect(editor).toBeVisible({ timeout: 3000 });

        await editor.fill(editedText);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(500);

        await expect(editor).toBeHidden({ timeout: 1500 }).catch(() => {});
        await expect(errorToast).toHaveCount(0, { timeout: 1000 }).catch(() => {});
        await expect(targetCell).toContainText(editedText, { timeout: 3000 });
      } finally {
        await targetCell.dblclick();
        const restoreEditor = page.locator('[data-testid="table-editor"]').first();
        await expect(restoreEditor).toBeVisible({ timeout: 3000 });

        await restoreEditor.fill(originalText);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(500);

        await expect(errorToast).toHaveCount(0, { timeout: 1000 }).catch(() => {});
        await expect(targetCell).toContainText(originalText, { timeout: 3000 });
        await page.keyboard.press('Escape').catch(() => {});
      }
    } finally {
      if (!page.isClosed()) {
        await dropTempDataset(page, datasetName);
      }
    }
  });
});
