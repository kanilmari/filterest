/**
 * N3_checkbox_child_bubble.spec.ts
 *
 * Verifies that child checkbox selection updates the parent checkbox state in
 * the permissions management tree.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import {
  findPermissionsFolderWithChildren,
  openPermissionsTree,
  PERMISSIONS_TREE_SELECTOR,
  readTreeCheckboxState,
  setTreeCheckboxState,
} from '../helpers/permissions-tree';

test.describe('N3 — Checkbox Child Bubble', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('child checkbox state bubbles to parent', async ({ page }) => {
    await openPermissionsTree(page);
    const folder = await findPermissionsFolderWithChildren(page);

    const parentSelector =
      `${PERMISSIONS_TREE_SELECTOR} .node[data-node-id="${folder.nodeId}"] > .node-row input[type="checkbox"]`;
    const childSelectors = Array.from({ length: folder.childCount }, (_value, index) =>
      `${PERMISSIONS_TREE_SELECTOR} .node[data-node-id="${folder.nodeId}"] > .children > .node:nth-child(${index + 1}) > .node-row input[type="checkbox"]`,
    );

    await setTreeCheckboxState(page, childSelectors[0], true);
    await page.waitForTimeout(300);

    const parentAfterFirstChild = await readTreeCheckboxState(page, parentSelector);
    if (folder.childCount === 1) {
      expect(parentAfterFirstChild.checked).toBe(true);
      expect(parentAfterFirstChild.indeterminate).toBe(false);
    } else {
      expect(parentAfterFirstChild.checked).toBe(false);
      expect(parentAfterFirstChild.indeterminate).toBe(true);
    }

    for (const childSelector of childSelectors) {
      await setTreeCheckboxState(page, childSelector, true);
    }
    await page.waitForTimeout(300);

    const parentAfterAllChildren = await readTreeCheckboxState(page, parentSelector);
    expect(parentAfterAllChildren.checked).toBe(true);
    expect(parentAfterAllChildren.indeterminate).toBe(false);
  });
});
