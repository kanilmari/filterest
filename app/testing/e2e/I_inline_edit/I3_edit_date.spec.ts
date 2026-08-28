/**
 * I3_edit_date.spec.ts
 *
 * Tests inline editing of date values in table view.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import {
  buildTempDatasetName,
  createTempDataset,
  dropTempDataset,
  openTempDataset,
} from '../helpers/temp-dataset';

test.describe('I3 — Edit Date', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('inline edit date cell', async ({ page }) => {
    test.setTimeout(60_000);
    const datasetName = buildTempDatasetName('e2e_inline_date');
    const originalDisplayText = '2026-01-15';
    const updatedDisplayText = '2026-01-16';

    await createTempDataset(page, {
      datasetName,
      columns: {
        id: 'SERIAL',
        due_date: 'DATE',
        label: 'TEXT',
      },
      seedRows: [
        {
          due_date: originalDisplayText,
          label: 'inline-date-row',
        },
      ],
    });

    try {
      await openTempDataset(page, datasetName, 'table');

      const updateRequests: Array<Record<string, unknown>> = [];
      page.on('request', (request) => {
        const requestUrl = new URL(request.url());
        if (
          request.method() === 'POST'
          && requestUrl.pathname === '/api/update-row'
          && requestUrl.searchParams.get('dataset') === datasetName
        ) {
          updateRequests.push(request.postDataJSON() as Record<string, unknown>);
        }
      });

      const dateCell = page.locator(
        `#${datasetName}_table_view_container [data-column="due_date"]`,
      ).first();
      await expect(dateCell).toContainText(originalDisplayText, { timeout: 10000 });

      const errorToast = page.locator('.toast-notification-item[data-toast-level="error"]');

      await dateCell.dblclick();
      const editor = page.locator('[data-testid="table-editor"][type="date"]').first();
      await expect(editor).toBeVisible({ timeout: 3000 });
      await expect(editor).toHaveValue(originalDisplayText);

      // Locator.blur() follows the editor's native commit path on every Playwright platform.
      await editor.blur();
      await page.waitForTimeout(300);
      expect(updateRequests).toHaveLength(0);

      await dateCell.dblclick();
      const updateEditor = page.locator('[data-testid="table-editor"][type="date"]').first();
      await expect(updateEditor).toBeVisible({ timeout: 3000 });
      await updateEditor.fill(updatedDisplayText);
      const updateResponsePromise = page.waitForResponse((response) => {
        const responseUrl = new URL(response.url());
        return response.request().method() === 'POST'
          && responseUrl.pathname === '/api/update-row'
          && responseUrl.searchParams.get('dataset') === datasetName;
      });
      await updateEditor.blur();
      const updateResponse = await updateResponsePromise;
      expect(updateResponse.ok()).toBe(true);

      await expect(errorToast).toHaveCount(0, { timeout: 2000 }).catch(() => {});
      await expect(dateCell).toContainText(updatedDisplayText, { timeout: 3000 });
      expect(updateRequests).toEqual([{
        id: expect.any(Number),
        column: 'due_date',
        value: updatedDisplayText,
      }]);

      await openTempDataset(page, datasetName, 'table');
      await expect(dateCell).toContainText(updatedDisplayText, { timeout: 10000 });
      await dateCell.dblclick();
      const persistedEditor = page.locator('[data-testid="table-editor"][type="date"]').first();
      await expect(persistedEditor).toHaveValue(updatedDisplayText, { timeout: 3000 });

      // Restore is a normal sequential assertion. If an earlier assertion fails,
      // cleanup runs without attempting a second update that could mask that failure.
      await persistedEditor.fill(originalDisplayText);
      const restoreResponsePromise = page.waitForResponse((response) => {
        const responseUrl = new URL(response.url());
        return response.request().method() === 'POST'
          && responseUrl.pathname === '/api/update-row'
          && responseUrl.searchParams.get('dataset') === datasetName;
      });
      await persistedEditor.blur();
      const restoreResponse = await restoreResponsePromise;
      expect(restoreResponse.ok()).toBe(true);

      await expect(errorToast).toHaveCount(0, { timeout: 2000 }).catch(() => {});
      await expect(dateCell).toContainText(originalDisplayText, { timeout: 3000 });
      expect(updateRequests).toHaveLength(2);

      await openTempDataset(page, datasetName, 'table');
      await expect(dateCell).toContainText(originalDisplayText, { timeout: 10000 });
      await dateCell.dblclick();
      const restoredEditor = page.locator('[data-testid="table-editor"][type="date"]').first();
      await expect(restoredEditor).toHaveValue(originalDisplayText, { timeout: 3000 });
      await restoredEditor.blur();
      await page.waitForTimeout(300);
      expect(updateRequests).toHaveLength(2);
    } finally {
      if (!page.isClosed()) {
        await dropTempDataset(page, datasetName);
      }
    }
  });
});
