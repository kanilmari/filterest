/**
 * permissions-tree.ts
 *
 * Stable helpers for the permissions view's checkbox tree.
 * N-tree checkbox specs use this instead of the sidebar nav tree, which now
 * renders button nodes without checkbox inputs.
 */

import { expect, type Page } from '@playwright/test';
import { openAdminTreeButton } from './admin-navigation';
import { waitForAppReady } from './navigation';

export const PERMISSIONS_TREE_SELECTOR = '#permissions_container #vanillaTree_table_rights';

type FolderWithChildren = {
  nodeId: string;
  childCount: number;
  childNodeIds: string[];
  expanded: boolean;
};

export async function openPermissionsTree(page: Page): Promise<void> {
  await waitForAppReady(page);
  await openAdminTreeButton(page, 'permissions');
  await expect(page.locator('#permissions_container')).toBeVisible({ timeout: 10000 });
  const tree = page.locator(PERMISSIONS_TREE_SELECTOR);
  await expect(tree).toBeVisible({ timeout: 10000 });
  await expect(tree.locator('input[type="checkbox"]').first()).toBeVisible({ timeout: 10000 });
}

export async function findPermissionsFolderWithChildren(
  page: Page,
): Promise<FolderWithChildren> {
  const folder = await page.evaluate(() => {
    const tree = document.querySelector(
      '#permissions_container #vanillaTree_table_rights',
    );
    if (!(tree instanceof HTMLElement)) {
      return null;
    }

    const candidates = Array.from(tree.querySelectorAll('.node'))
      .map((node) => {
        if (!(node instanceof HTMLElement)) {
          return null;
        }

        const childContainer = node.querySelector(':scope > .children');
        if (!(childContainer instanceof HTMLElement)) {
          return null;
        }

        const childCount = Array.from(childContainer.children).filter((child) => {
          if (!(child instanceof HTMLElement)) {
            return false;
          }

          return Boolean(child.querySelector(':scope > .node-row input[type="checkbox"]'));
        }).length;

        if (childCount === 0) {
          return null;
        }

        return {
          nodeId: node.getAttribute('data-node-id') || '',
          childCount,
          childNodeIds: Array.from(childContainer.children)
            .map((child) => {
              if (!(child instanceof HTMLElement)) {
                return '';
              }
              const childCheckbox = child.querySelector(':scope > .node-row input[type="checkbox"]');
              if (!(childCheckbox instanceof HTMLInputElement)) {
                return '';
              }
              return child.getAttribute('data-node-id') || '';
            })
            .filter(Boolean),
          expanded: !childContainer.hidden,
        };
      })
      .filter(Boolean) as FolderWithChildren[];

    return candidates.find((candidate) => candidate.expanded) || candidates[0] || null;
  });

  if (!folder?.nodeId) {
    throw new Error('Could not find a permissions tree folder with direct checkbox children.');
  }

  const childContainer = page.locator(
    `${PERMISSIONS_TREE_SELECTOR} .node[data-node-id="${folder.nodeId}"] > .children`,
  );
  if (!(await childContainer.isVisible().catch(() => false))) {
    await page.evaluate((nodeId) => {
      const toggle = document.querySelector(
        `#permissions_container #vanillaTree_table_rights .node[data-node-id="${nodeId}"] > .node-row [data-testid="tree-toggle"]`,
      ) as HTMLElement | null;
      toggle?.click();
    }, folder.nodeId);
    await expect(childContainer).toBeVisible({ timeout: 5000 });
    folder.expanded = true;
  }

  return folder;
}

export async function setTreeCheckboxState(
  page: Page,
  selector: string,
  checked: boolean,
): Promise<void> {
  const updated = await page.evaluate(({ checked: nextChecked, selector: targetSelector }) => {
    const checkbox = document.querySelector(targetSelector);
    if (!(checkbox instanceof HTMLInputElement)) {
      return false;
    }

    checkbox.checked = nextChecked;
    checkbox.indeterminate = false;
    checkbox.setAttribute('data-indeterminate', 'false');
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, { checked, selector });

  if (!updated) {
    throw new Error(`Could not update tree checkbox for selector "${selector}".`);
  }
}

export async function readTreeCheckboxState(
  page: Page,
  selector: string,
): Promise<{ checked: boolean; indeterminate: boolean }> {
  const state = await page.evaluate((targetSelector) => {
    const checkbox = document.querySelector(targetSelector);
    if (!(checkbox instanceof HTMLInputElement)) {
      return null;
    }

    return {
      checked: checkbox.checked,
      indeterminate: checkbox.indeterminate,
    };
  }, selector);

  if (!state) {
    throw new Error(`Could not read tree checkbox state for selector "${selector}".`);
  }

  return state;
}
