/**
 * D3_switch_to_tree.spec.ts
 *
 * Tests switching to tree view using the view selector button.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import {
  buildTempDatasetName,
  createTempDataset,
  dropTempDataset,
  openTempDataset,
} from '../helpers/temp-dataset';

test.describe('D3 — Switch to Tree View', () => {
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

  test('can switch to tree view', async ({ page }) => {
    const datasetName = buildTempDatasetName('e2e_tree_view');
    await createTempDataset(page, {
      datasetName,
      columns: {
        id: 'SERIAL',
        name: 'TEXT',
        type: 'TEXT',
        parent_id: 'INTEGER',
        description: 'TEXT',
      },
      seedRows: [
        {
          name: 'Root node',
          type: 'folder',
          description: 'root description',
        },
        {
          name: 'Child node',
          type: 'item',
          parent_id: 1,
          description: 'child description',
        },
      ],
    });

    try {
      await openTempDataset(page, datasetName, 'tree');

      const treeContainer = page.locator(`#${datasetName}_tree_view_container .tree-container`);
      await expect(treeContainer).toBeVisible({ timeout: 10000 });
      await expect(treeContainer.getByText('Folder: Root node')).toBeVisible({ timeout: 10000 });
      await expect(treeContainer.getByText('Item: Child node')).toBeVisible({ timeout: 10000 });
    } finally {
      await dropTempDataset(page, datasetName);
    }
  });
});
