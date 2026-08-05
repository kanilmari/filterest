/**
 * A2_edit_cell.spec.ts
 *
 * Tests inline cell editing: double-click enters edit mode, Escape cancels.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import {
  buildTempDatasetName,
  createTempDataset,
  dropTempDataset,
  openTempDataset,
} from '../helpers/temp-dataset';

test.describe('A2 — Edit Cell', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('double-click cell enters edit mode, Escape cancels', async ({ page }) => {
    const datasetName = buildTempDatasetName('e2e_edit_cell');
    const originalText = `edit-cell-original-${Date.now().toString(36)}`;

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

      const editableCell = page.locator(
        `#${datasetName}_table_view_container [data-column="title"]`,
      ).first();
      await expect(editableCell).toBeVisible({ timeout: 10000 });
      await expect(editableCell).toContainText(originalText, { timeout: 10000 });

      await editableCell.dblclick();
      const editInput = page.locator('[data-testid="table-editor"]').first();
      await expect(editInput).toBeVisible({ timeout: 3000 });

      await page.keyboard.press('Escape');
      await expect(editInput).toBeHidden({ timeout: 5000 });
      await expect(editableCell).toContainText(originalText, { timeout: 3000 });
    } finally {
      if (!page.isClosed()) {
        await dropTempDataset(page, datasetName);
      }
    }
  });
});
