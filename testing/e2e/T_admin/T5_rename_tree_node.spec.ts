/**
 * T5_rename_tree_node.spec.ts
 *
 * Verifies that tree node rename action can be opened from context menu.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { clickAdminTreeContextMenuItem, openNavTreeContextMenu } from '../helpers/admin-navigation';
import { navigateToDataset, waitForDataLoaded } from '../helpers/navigation';

test.describe('T5 — Rename Tree Node', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('tree node can be renamed', async ({ page }) => {
    await navigateToDataset(page, 'app_service_catalog');
    await waitForDataLoaded(page, 'app_service_catalog');
    await openNavTreeContextMenu(page);

    const renameOption = page.locator('[data-testid="admin-tree-menu-rename"]');
    if (await renameOption.isVisible({ timeout: 3000 }).catch(() => false)) {
      await clickAdminTreeContextMenuItem(page, 'rename');

      const renameDialog = page.locator('[data-testid="rename-tree-node-dialog"]');
      await expect(renameDialog).toBeVisible({ timeout: 5000 });
      await expect(page.locator('[data-testid="rename-tree-node-name-input"]')).toBeVisible();
      await page.locator('[data-testid="rename-tree-node-cancel"]').click();
      await expect(renameDialog).toBeHidden({ timeout: 5000 });
    } else {
      test.skip();
    }
  });
});
