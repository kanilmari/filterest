/**
 * D4_switch_to_transposed.spec.ts
 *
 * Tests switching to transposed view using the view selector button.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import {
  buildTempDatasetName,
  createTempDataset,
  dropTempDataset,
  openTempDataset,
} from '../helpers/temp-dataset';

test.describe('D4 — Switch to Transposed View', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await login(page, credentials);
  });

  test('can switch to transposed view', async ({ page }) => {
    const datasetName = buildTempDatasetName('e2e_transposed_view');
    await createTempDataset(page, {
      datasetName,
      columns: {
        id: 'SERIAL',
        name: 'TEXT',
        type: 'TEXT',
        description: 'TEXT',
      },
      seedRows: [
        {
          name: 'Alpha row',
          type: 'folder',
          description: 'first description',
        },
        {
          name: 'Beta row',
          type: 'item',
          description: 'second description',
        },
      ],
    });

    try {
      await openTempDataset(page, datasetName, 'transposed');

      const transposedTable = page.locator(`#${datasetName}_transposed_view_container .table`);
      await expect(transposedTable).toBeVisible({ timeout: 10000 });
      await expect(transposedTable.locator('.row').first()).toBeVisible({ timeout: 10000 });
      await expect(transposedTable).toContainText('name');
      await expect(transposedTable).toContainText('Alpha row');
      await expect(transposedTable).toContainText('Beta row');
    } finally {
      await dropTempDataset(page, datasetName);
    }
  });
});
