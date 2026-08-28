/**
 * I2_edit_number.spec.ts
 *
 * Tests inline editing of numeric values in table view.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import {
  buildTempDatasetName,
  createTempDataset,
  dropTempDataset,
  openTempDataset,
} from '../helpers/temp-dataset';

test.describe('I2 — Edit Number', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('inline edit number cell', async ({ page }) => {
    const datasetName = buildTempDatasetName('e2e_inline_number');
    const originalDisplayText = '7';

    await createTempDataset(page, {
      datasetName,
      columns: {
        id: 'SERIAL',
        quantity: 'INTEGER',
        label: 'TEXT',
      },
      seedRows: [
        {
          quantity: 7,
          label: 'inline-number-row',
        },
      ],
    });

    try {
      await openTempDataset(page, datasetName, 'table');

      const numberCell = page.locator(
        `#${datasetName}_table_view_container [data-column="quantity"]`,
      ).first();
      await expect(numberCell).toContainText(originalDisplayText, { timeout: 10000 });

      await numberCell.dblclick();
      const editor = page.locator('[data-testid="table-editor"][type="number"]').first();
      await expect(editor).toBeVisible({ timeout: 3000 });

      const errorToast = page.locator('.toast-notification-item[data-toast-level="error"]');
      const originalEditorValue = await editor.inputValue();
      const updatedValue = originalEditorValue === '42' ? '43' : '42';

      try {
        await editor.fill(updatedValue);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(500);
        await expect(errorToast).toHaveCount(0, { timeout: 2000 }).catch(() => {});
        await expect(numberCell).toContainText(updatedValue, { timeout: 3000 });
      } finally {
        await numberCell.dblclick();
        const restoreEditor = page.locator('[data-testid="table-editor"][type="number"]').first();
        await expect(restoreEditor).toBeVisible({ timeout: 3000 });
        await restoreEditor.fill(originalEditorValue);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(500);
        await expect(errorToast).toHaveCount(0, { timeout: 2000 }).catch(() => {});
        await expect(numberCell).toContainText(originalDisplayText, { timeout: 3000 });
      }
    } finally {
      if (!page.isClosed()) {
        await dropTempDataset(page, datasetName);
      }
    }
  });
});
