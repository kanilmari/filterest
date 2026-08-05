/**
 * navigation-tree.ts — Helpers for opening the disclosure-backed admin navigation tree.
 *
 * Keeps tree tests on Playwright's normal actionability path while sharing the
 * disclosure readiness contract between navigation and tree interaction specs.
 */

import { expect, type Locator, type Page } from '@playwright/test';
import { waitForAppReady } from './navigation';
import { ensureNavbarVisible } from './navbar';

export async function openAdminNavigationTree(page: Page): Promise<Locator> {
  await waitForAppReady(page);
  await ensureNavbarVisible(page);

  const adminToolsGroup = page
    .locator('[data-testid="nav-group-admin-and-development-tools"]:visible')
    .first();
  await expect(adminToolsGroup).toBeVisible({ timeout: 10000 });

  if ((await adminToolsGroup.getAttribute('aria-expanded')) !== 'true') {
    await adminToolsGroup.scrollIntoViewIfNeeded();
    await adminToolsGroup.click();
  }

  await expect(adminToolsGroup).toHaveAttribute('aria-expanded', 'true');

  const navigationTreeRoot = page.locator('#nav_tree:visible').first();
  await expect(navigationTreeRoot).toBeVisible({ timeout: 10000 });

  const renderedNavigationTree = navigationTreeRoot.locator('#vanillaTree_nav:visible').first();
  await expect(renderedNavigationTree).toBeVisible({ timeout: 10000 });
  return renderedNavigationTree;
}

/**
 * Reveals and returns the first dataset button by opening real tree folders as needed.
 * Bridges a freshly collapsed navigation tree and tests that need an actionable leaf.
 * Exists so E2E navigation never depends on persisted expansion state or DOM-click shortcuts.
 */
export async function revealFirstNavigationDatasetButton(
  navigationTree: Locator,
): Promise<Locator> {
  const visibleDatasetButton = navigationTree
    .locator(
      '.node[data-table-uid] > .node-row > '
      + '[data-testid^="nav-tree-btn-"]:visible',
    )
    .first();

  for (let depth = 0; depth < 32; depth += 1) {
    if (await visibleDatasetButton.isVisible()) {
      return visibleDatasetButton;
    }

    const collapsedFolder = navigationTree
      .locator(
        '.node:visible:has(> [data-testid="tree-children"] > .node)'
        + ':has(> .node-row > [data-testid="tree-toggle"][aria-expanded="false"])',
      )
      .first();
    await expect(
      collapsedFolder,
      'Navigation tree must expose a collapsed folder leading to a dataset leaf',
    ).toBeVisible({ timeout: 10000 });

    const folderNodeId = await collapsedFolder.getAttribute('data-node-id');
    expect(
      folderNodeId,
      'Collapsed navigation folder must expose a stable data-node-id',
    ).toBeTruthy();
    const stableFolder = navigationTree
      .locator(`.node[data-node-id=${JSON.stringify(folderNodeId)}]`)
      .first();
    const folderToggle = stableFolder.locator(
      ':scope > .node-row > [data-testid="tree-toggle"]',
    );
    const folderChildren = stableFolder.locator(
      ':scope > [data-testid="tree-children"]',
    );
    await folderToggle.scrollIntoViewIfNeeded();
    await folderToggle.click();
    await expect(folderToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(folderChildren).toBeVisible();
  }

  throw new Error('Navigation tree exceeded its supported depth without revealing a dataset leaf.');
}

/**
 * Reveals one exact navigation-tree dataset button through its real ancestor toggles.
 * Bridges stable tree node ids and tests that create a dataset during the current run.
 * Exists so those tests do not depend on obsolete folder-specific test ids or DOM clicks.
 */
export async function revealNavigationDatasetButtonByNodeId(
  navigationTree: Locator,
  datasetNodeId: string,
): Promise<Locator> {
  const targetNode = navigationTree
    .locator(`.node[data-node-id=${JSON.stringify(datasetNodeId)}]`)
    .first();
  await expect(targetNode).toBeAttached({ timeout: 10000 });
  const targetButton = targetNode
    .locator(`:scope > .node-row > [data-testid=${JSON.stringify(`nav-tree-btn-${datasetNodeId}`)}]`)
    .first();

  for (let depth = 0; depth < 32; depth += 1) {
    if (await targetButton.isVisible()) {
      return targetButton;
    }

    const collapsedAncestor = navigationTree
      .locator(
        `.node:visible:has(.node[data-node-id=${JSON.stringify(datasetNodeId)}])`
        + ':has(> .node-row > [data-testid="tree-toggle"][aria-expanded="false"])',
      )
      .first();
    await expect(
      collapsedAncestor,
      `Navigation tree must expose a collapsed ancestor for dataset node ${datasetNodeId}`,
    ).toBeVisible({ timeout: 10000 });

    const ancestorNodeId = await collapsedAncestor.getAttribute('data-node-id');
    expect(ancestorNodeId, 'Collapsed navigation ancestor must expose data-node-id').toBeTruthy();
    const stableAncestor = navigationTree
      .locator(`.node[data-node-id=${JSON.stringify(ancestorNodeId)}]`)
      .first();
    const toggle = stableAncestor.locator(':scope > .node-row > [data-testid="tree-toggle"]');
    await toggle.scrollIntoViewIfNeeded();
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  }

  throw new Error(`Navigation tree could not reveal dataset node ${datasetNodeId}.`);
}
