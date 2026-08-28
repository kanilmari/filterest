/**
 * I1_edit_text.spec.ts
 *
 * Tests inline editing of text values in table view.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import {
  buildTempDatasetName,
  createTempDataset,
  dropTempDataset,
  openTempDataset,
} from '../helpers/temp-dataset';

test.describe('I1 — Edit Text', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('inline edit text cell', async ({ page }) => {
    const datasetName = buildTempDatasetName('e2e_inline_text');
    const originalText = `inline-text-original-${Date.now().toString(36)}`;
    const editedValue = `inline-text-edited-${Date.now().toString(36)}`;

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

      await targetCell.dblclick();
      const editor = page.locator('[data-testid="table-editor"]').first();
      await expect(editor).toBeVisible({ timeout: 3000 });

      try {
        await editor.fill(editedValue);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(500);
        await expect(errorToast).toHaveCount(0, { timeout: 2000 }).catch(() => {});
        await expect(targetCell).toContainText(editedValue, { timeout: 3000 });
      } finally {
        await targetCell.dblclick();
        const restoreEditor = page.locator('[data-testid="table-editor"]').first();
        await expect(restoreEditor).toBeVisible({ timeout: 3000 });
        await restoreEditor.fill(originalText);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(500);
        await expect(errorToast).toHaveCount(0, { timeout: 2000 }).catch(() => {});
        await expect(targetCell).toContainText(originalText, { timeout: 3000 });
      }
    } finally {
      if (!page.isClosed()) {
        await dropTempDataset(page, datasetName);
      }
    }
  });
});
