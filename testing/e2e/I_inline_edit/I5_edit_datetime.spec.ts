/**
 * I5_edit_datetime.spec.ts
 *
 * Tests inline editing of datetime values in table view.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import {
  buildTempDatasetName,
  createTempDataset,
  dropTempDataset,
  openTempDataset,
} from '../helpers/temp-dataset';

test.describe('I5 — Edit Datetime', () => {
  test.use({ timezoneId: 'Asia/Hong_Kong' });

  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('inline edit datetime cell', async ({ page }) => {
    test.setTimeout(60_000);
    const datasetName = buildTempDatasetName('e2e_inline_datetime');
    const originalEditorValue = '2026-06-14T09:30';
    const updatedEditorValue = '2026-06-15T14:30';

    await createTempDataset(page, {
      datasetName,
      columns: {
        id: 'SERIAL',
        scheduled_at: 'TIMESTAMP',
        label: 'TEXT',
      },
      seedRows: [
        {
          scheduled_at: '2026-06-14 09:30:00',
          label: 'inline-datetime-row',
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

      const dtCell = page.locator(
        `#${datasetName}_table_view_container [data-column="scheduled_at"]`,
      ).first();
      await expect(dtCell).toContainText('2026-06-14', { timeout: 10000 });

      await dtCell.dblclick();

      const editor = page.locator('[data-testid="table-editor"][type="datetime-local"]').first();
      await expect(editor).toBeVisible({ timeout: 3000 });
      await expect(editor).toHaveValue(originalEditorValue);

      await page.keyboard.press('Enter');
      await page.waitForTimeout(300);
      expect(updateRequests).toHaveLength(0);

      await dtCell.dblclick();
      const updateEditor = page.locator('[data-testid="table-editor"][type="datetime-local"]').first();
      await expect(updateEditor).toBeVisible({ timeout: 3000 });
      const errorToast = page.locator('.toast-notification-item[data-toast-level="error"]');

      try {
        await updateEditor.fill(updatedEditorValue);
        const updateResponsePromise = page.waitForResponse((response) => {
          const responseUrl = new URL(response.url());
          return response.request().method() === 'POST'
            && responseUrl.pathname === '/api/update-row'
            && responseUrl.searchParams.get('dataset') === datasetName;
        });
        await page.keyboard.press('Enter');
        const updateResponse = await updateResponsePromise;
        expect(updateResponse.ok()).toBe(true);
        await expect(errorToast).toHaveCount(0, { timeout: 2000 }).catch(() => {});
        expect(updateRequests).toEqual([{
          id: expect.any(Number),
          column: 'scheduled_at',
          value: '2026-06-15 14:30:00',
        }]);

        await openTempDataset(page, datasetName, 'table');
        await expect(dtCell).toContainText('2026-06-15', { timeout: 10000 });
        await dtCell.dblclick();
        const savedEditor = page.locator('[data-testid="table-editor"][type="datetime-local"]').first();
        await expect(savedEditor).toHaveValue(updatedEditorValue, { timeout: 3000 });
      } finally {
        const restoreEditor = page.locator('[data-testid="table-editor"][type="datetime-local"]').first();
        if (!await restoreEditor.isVisible({ timeout: 500 }).catch(() => false)) {
          await dtCell.dblclick();
        }
        await expect(restoreEditor).toBeVisible({ timeout: 3000 });
        await restoreEditor.fill(originalEditorValue);
        const restoreResponsePromise = page.waitForResponse((response) => {
          const responseUrl = new URL(response.url());
          return response.request().method() === 'POST'
            && responseUrl.pathname === '/api/update-row'
            && responseUrl.searchParams.get('dataset') === datasetName;
        });
        await page.keyboard.press('Enter');
        const restoreResponse = await restoreResponsePromise;
        expect(restoreResponse.ok()).toBe(true);
        await expect(errorToast).toHaveCount(0, { timeout: 2000 }).catch(() => {});
        expect(updateRequests).toHaveLength(2);

        await openTempDataset(page, datasetName, 'table');
        await expect(dtCell).toContainText('2026-06-14', { timeout: 10000 });
        await dtCell.dblclick();
        const restoredEditor = page.locator('[data-testid="table-editor"][type="datetime-local"]').first();
        await expect(restoredEditor).toHaveValue(originalEditorValue, { timeout: 3000 });
        await page.keyboard.press('Enter');
        await page.waitForTimeout(300);
        expect(updateRequests).toHaveLength(2);
      }
    } finally {
      if (!page.isClosed()) {
        await dropTempDataset(page, datasetName);
      }
    }
  });

  test('inline edit TIMESTAMPTZ preserves the instant', async ({ page }) => {
    test.setTimeout(60_000);
    const datasetName = buildTempDatasetName('e2e_inline_timestamptz');
    const originalEditorValue = '2026-06-14T09:30';
    const updatedEditorValue = '2026-06-14T10:45';

    await createTempDataset(page, {
      datasetName,
      columns: {
        id: 'SERIAL',
        published_at: 'TIMESTAMPTZ',
        label: 'TEXT',
      },
      seedRows: [{
        published_at: '2026-06-14T01:30:00Z',
        label: 'inline-timestamptz-row',
      }],
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

      const timestampCell = page.locator(
        `#${datasetName}_table_view_container [data-column="published_at"]`,
      ).first();
      await expect(timestampCell).toContainText('09:30', { timeout: 10000 });

      await timestampCell.dblclick();
      const editor = page.locator('[data-testid="table-editor"][type="datetime-local"]').first();
      await expect(editor).toHaveValue(originalEditorValue, { timeout: 3000 });
      await page.keyboard.press('Enter');
      await page.waitForTimeout(300);
      expect(updateRequests).toHaveLength(0);

      await timestampCell.dblclick();
      const updateEditor = page.locator('[data-testid="table-editor"][type="datetime-local"]').first();
      await updateEditor.fill(updatedEditorValue);
      const updateResponsePromise = page.waitForResponse((response) => {
        const responseUrl = new URL(response.url());
        return response.request().method() === 'POST'
          && responseUrl.pathname === '/api/update-row'
          && responseUrl.searchParams.get('dataset') === datasetName;
      });
      await page.keyboard.press('Enter');
      expect((await updateResponsePromise).ok()).toBe(true);
      expect(updateRequests).toEqual([{
        id: expect.any(Number),
        column: 'published_at',
        value: '2026-06-14T02:45:00.000Z',
      }]);

      await openTempDataset(page, datasetName, 'table');
      await expect(timestampCell).toContainText('10:45', { timeout: 10000 });
      await timestampCell.dblclick();
      const savedEditor = page.locator('[data-testid="table-editor"][type="datetime-local"]').first();
      await expect(savedEditor).toHaveValue(updatedEditorValue, { timeout: 3000 });

      await savedEditor.fill(originalEditorValue);
      const restoreResponsePromise = page.waitForResponse((response) => {
        const responseUrl = new URL(response.url());
        return response.request().method() === 'POST'
          && responseUrl.pathname === '/api/update-row'
          && responseUrl.searchParams.get('dataset') === datasetName;
      });
      await page.keyboard.press('Enter');
      expect((await restoreResponsePromise).ok()).toBe(true);
      expect(updateRequests).toHaveLength(2);
      expect(updateRequests[1]?.value).toBe('2026-06-14T01:30:00.000Z');

      await openTempDataset(page, datasetName, 'table');
      await expect(timestampCell).toContainText('09:30', { timeout: 10000 });
      await timestampCell.dblclick();
      const restoredEditor = page.locator('[data-testid="table-editor"][type="datetime-local"]').first();
      await expect(restoredEditor).toHaveValue(originalEditorValue, { timeout: 3000 });
      await page.keyboard.press('Enter');
      await page.waitForTimeout(300);
      expect(updateRequests).toHaveLength(2);
    } finally {
      if (!page.isClosed()) {
        await dropTempDataset(page, datasetName);
      }
    }
  });
});
