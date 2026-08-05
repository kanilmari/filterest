/**
 * N1_tree_expand_collapse.spec.ts
 *
 * Verifies that a tree node in sidebar navigation can be expanded and collapsed.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { openAdminNavigationTree } from '../helpers/navigation-tree';

test.describe('N1 — Tree Expand Collapse', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('tree node can be expanded and collapsed', async ({ page }) => {
    const navigationTree = await openAdminNavigationTree(page);
    const folderNode = navigationTree
      .locator('.node:visible:has(> [data-testid="tree-children"] > .node)')
      .first();
    await expect(folderNode).toBeVisible({ timeout: 10000 });

    const expandToggle = folderNode.locator(
      ':scope > .node-row > [data-testid="tree-toggle"]',
    );
    const children = folderNode.locator(':scope > [data-testid="tree-children"]');
    await expect(expandToggle).toBeVisible();
    await expect(children).toHaveCount(1);

    const initialExpanded = (await expandToggle.getAttribute('aria-expanded')) === 'true';

    const assertExpansionState = async (expanded: boolean) => {
      await expect(expandToggle).toHaveAttribute('aria-expanded', String(expanded));
      await expect(folderNode).toHaveAttribute('data-expanded', String(expanded));
      if (expanded) {
        await expect(children).toBeVisible();
      } else {
        await expect(children).toBeHidden();
      }
    };

    const toggleAndAssert = async (expanded: boolean) => {
      await expandToggle.scrollIntoViewIfNeeded();
      await expandToggle.click();
      await assertExpansionState(expanded);
    };

    try {
      if (initialExpanded) {
        await toggleAndAssert(false);
        await toggleAndAssert(true);
      } else {
        await toggleAndAssert(true);
        await toggleAndAssert(false);
      }
    } finally {
      if (
        !page.isClosed() &&
        (await expandToggle.getAttribute('aria-expanded')) !== String(initialExpanded)
      ) {
        await toggleAndAssert(initialExpanded);
      }
    }

    await assertExpansionState(initialExpanded);
  });
});
