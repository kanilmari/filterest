/**
 * A5_select_all.spec.ts
 *
 * Tests master checkbox selects and deselects all rows.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import {
  buildTempDatasetName,
  createTempDataset,
  dropTempDataset,
  openTempDataset,
} from '../helpers/temp-dataset';

test.describe('A5 — Select All', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('master checkbox selects and deselects all rows', async ({ page }) => {
    const datasetName = buildTempDatasetName('e2e_select_all');

    await createTempDataset(page, {
      datasetName,
      columns: {
        id: 'SERIAL',
        title: 'TEXT',
        status: 'TEXT',
      },
      seedRows: [
        {
          title: 'select-all-row-1',
          status: 'draft',
        },
        {
          title: 'select-all-row-2',
          status: 'published',
        },
      ],
    });

    try {
      await openTempDataset(page, datasetName, 'table');

      const masterCheckbox = page.locator('[data-testid="row-select-all-checkbox"]');
      await expect(masterCheckbox).toBeVisible({ timeout: 5000 });

      await masterCheckbox.check();

      const bodyCheckboxes = page.locator('[data-testid="row-select-checkbox"]');
      const count = await bodyCheckboxes.count();
      expect(count).toBeGreaterThan(0);

      for (let i = 0; i < count; i += 1) {
        await expect(bodyCheckboxes.nth(i)).toBeChecked({ timeout: 3000 });
      }

      await masterCheckbox.uncheck();

      for (let i = 0; i < count; i += 1) {
        await expect(bodyCheckboxes.nth(i)).not.toBeChecked({ timeout: 3000 });
      }
    } finally {
      if (!page.isClosed()) {
        await dropTempDataset(page, datasetName);
      }
    }
  });
});
