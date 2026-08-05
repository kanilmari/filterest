/**
 * N2_checkbox_parent_cascade.spec.ts
 *
 * Verifies that checking and unchecking a parent node cascades to child
 * checkboxes in the permissions management tree.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import {
  findPermissionsFolderWithChildren,
  openPermissionsTree,
  PERMISSIONS_TREE_SELECTOR,
  setTreeCheckboxState,
} from '../helpers/permissions-tree';

test.describe('N2 — Checkbox Parent Cascade', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('checking parent cascades to children', async ({ page }) => {
    await openPermissionsTree(page);
    const folder = await findPermissionsFolderWithChildren(page);

    const parentSelector =
      `${PERMISSIONS_TREE_SELECTOR} .node[data-node-id="${folder.nodeId}"] > .node-row input[type="checkbox"]`;
    const childCheckboxes = page.locator(
      `${PERMISSIONS_TREE_SELECTOR} .node[data-node-id="${folder.nodeId}"] > .children > .node > .node-row input[type="checkbox"]`,
    );

    expect(await childCheckboxes.count()).toBe(folder.childCount);

    await setTreeCheckboxState(page, parentSelector, true);
    await page.waitForTimeout(300);

    for (let i = 0; i < folder.childCount; i++) {
      await expect(childCheckboxes.nth(i)).toBeChecked();
    }

    await setTreeCheckboxState(page, parentSelector, false);
    await page.waitForTimeout(300);

    for (let i = 0; i < folder.childCount; i++) {
      await expect(childCheckboxes.nth(i)).not.toBeChecked();
    }
  });
});
