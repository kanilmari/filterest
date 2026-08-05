/**
 * N4_checkbox_state_collect.spec.ts
 *
 * Verifies that checked checkbox state can be collected from the permissions
 * management tree after user interaction.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import {
  findPermissionsFolderWithChildren,
  openPermissionsTree,
  PERMISSIONS_TREE_SELECTOR,
  setTreeCheckboxState,
} from '../helpers/permissions-tree';

test.describe('N4 — Checkbox State Collect', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('checked state can be collected from tree', async ({ page }) => {
    await openPermissionsTree(page);
    const folder = await findPermissionsFolderWithChildren(page);

    const expectedCheckedIds = await page.evaluate((folderNodeId) => {
      const childNodes = Array.from(document.querySelectorAll(
        `#permissions_container #vanillaTree_table_rights .node[data-node-id="${folderNodeId}"] > .children > .node`,
      ));

      return childNodes
        .slice(0, 2)
        .map((node) => node instanceof HTMLElement ? node.getAttribute('data-node-id') || '' : '')
        .filter(Boolean);
    }, folder.nodeId);

    const firstChildSelector =
      `${PERMISSIONS_TREE_SELECTOR} .node[data-node-id="${folder.nodeId}"] > .children > .node:nth-child(1) > .node-row input[type="checkbox"]`;
    const secondChildSelector = folder.childCount > 1
      ? `${PERMISSIONS_TREE_SELECTOR} .node[data-node-id="${folder.nodeId}"] > .children > .node:nth-child(2) > .node-row input[type="checkbox"]`
      : null;

    await setTreeCheckboxState(page, firstChildSelector, true);
    if (secondChildSelector) {
      await setTreeCheckboxState(page, secondChildSelector, true);
    }
    await page.waitForTimeout(300);

    const checkedStates = await page.evaluate(() => {
      const tree = document.querySelector('#permissions_container #vanillaTree_table_rights');
      if (!(tree instanceof HTMLElement)) {
        return [];
      }

      return Array.from(tree.querySelectorAll('.node input[type="checkbox"]'))
        .map((checkbox) => {
          if (!(checkbox instanceof HTMLInputElement) || !checkbox.checked) {
            return null;
          }

          const node = checkbox.closest('.node');
          return node instanceof HTMLElement ? node.getAttribute('data-node-id') || '' : '';
        })
        .filter(Boolean);
    });

    expect(expectedCheckedIds.length).toBeGreaterThan(0);
    for (const nodeId of expectedCheckedIds) {
      expect(checkedStates).toContain(nodeId);
    }
  });
});
