/**
 * G1_tree_table_select.spec.ts
 *
 * Verifies that clicking a navigation tree node loads the corresponding table/view.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { waitForAppReady, waitForDataLoaded } from '../helpers/navigation';
import {
  openAdminNavigationTree,
  revealFirstNavigationDatasetButton,
} from '../helpers/navigation-tree';

test.describe('G1 — Tree Table Select', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
    await waitForAppReady(page);
  });

  test('clicking tree node navigates to table', async ({ page }) => {
    const navigationTree = await openAdminNavigationTree(page);
    const treeNode = await revealFirstNavigationDatasetButton(navigationTree);
    await expect(treeNode).toBeVisible({ timeout: 10000 });

    const datasetName = await treeNode.getAttribute('data-lang-key');
    expect(datasetName, 'Navigation tree leaf must identify its dataset').toBeTruthy();

    await treeNode.scrollIntoViewIfNeeded();
    await treeNode.click();
    await waitForDataLoaded(page, datasetName!);

    const datasetSurfaceIds = [
      `${datasetName}_tab_parts_container`,
      `${datasetName}_table_view_container`,
      `${datasetName}_card_view_container`,
      `${datasetName}_tree_view_container`,
      `${datasetName}_transposed_view_container`,
      `${datasetName}_ticket_view_container`,
      `${datasetName}_settings_view_container`,
    ];
    const visibleDatasetSurface = page
      .locator(datasetSurfaceIds.map((id) => `[id=${JSON.stringify(id)}]:visible`).join(', '))
      .first();
    await expect(visibleDatasetSurface).toBeVisible({ timeout: 15000 });
  });
});
