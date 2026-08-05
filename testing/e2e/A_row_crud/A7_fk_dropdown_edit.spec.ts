/**
 * A7_fk_dropdown_edit.spec.ts
 *
 * Tests FK dropdown opens when clicking a FK cell in inline edit mode.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import {
  buildTempDatasetName,
  createTempDataset,
  dropTempDataset,
  openTempDataset,
} from '../helpers/temp-dataset';

test.describe('A7 — FK Dropdown Edit', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('clicking FK cell opens reference dropdown', async ({ page }) => {
    const referencedDatasetName = buildTempDatasetName('e2e_fk_reference');
    const datasetName = buildTempDatasetName('e2e_fk_inline');

    await createTempDataset(page, {
      datasetName: referencedDatasetName,
      columns: {
        id: 'SERIAL',
        name: 'TEXT',
      },
      seedRows: [
        { name: 'Reference A' },
        { name: 'Reference B' },
      ],
    });

    await createTempDataset(page, {
      datasetName,
      columns: {
        id: 'SERIAL',
        category_id: 'INTEGER',
        title: 'TEXT',
      },
      foreignKeys: [
        {
          referencing_column: 'category_id',
          referenced_dataset: referencedDatasetName,
          referenced_column: 'id',
        },
      ],
      seedRows: [
        {
          category_id: 1,
          title: 'FK row',
        },
      ],
    });

    try {
      await openTempDataset(page, datasetName, 'table');

      const rowCells = page.locator(
        `#${datasetName}_table_view_container tbody tr:first-child [data-testid^="table-cell-"]`,
      );
      const cellCount = await rowCells.count();
      expect(cellCount).toBeGreaterThan(0);

      let dropdownOpened = false;

      for (let i = 0; i < cellCount; i += 1) {
        const cell = rowCells.nth(i);
        await expect(cell).toBeVisible({ timeout: 10000 });
        await cell.evaluate((element: HTMLElement) => {
          element.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        });
        await page.waitForTimeout(300);

        const dropdown = page.locator('[data-testid="inline-fk-dropdown"]').first();
        if (await dropdown.isVisible({ timeout: 2000 }).catch(() => false)) {
          dropdownOpened = true;
          await expect(dropdown).toBeVisible();
          await expect(page.locator('[data-testid="inline-fk-search-input"]').first()).toBeVisible();
          await page.keyboard.press('Escape');
          await expect(dropdown).toBeHidden({ timeout: 5000 }).catch(() => {});
          break;
        }

        await page.keyboard.press('Escape').catch(() => {});
      }

      expect(dropdownOpened).toBe(true);
    } finally {
      if (!page.isClosed()) {
        await dropTempDataset(page, datasetName);
        await dropTempDataset(page, referencedDatasetName);
      }
    }
  });
});
