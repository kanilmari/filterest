/**
 * admin-navigation.ts
 *
 * Provides stable Playwright helpers for opening admin sidebar groups and views.
 * Uses frontend data-testid anchors instead of brittle CSS-class or text selectors.
 */

import { type Page } from '@playwright/test';

function getAdminTreeAnchorSelector(targetId: string): string {
  return [
    `[data-testid="admin-tree-folder-${targetId}"]`,
    `[data-testid="admin-tree-btn-${targetId}"]`,
    `[data-testid="admin-tree-label-${targetId}"]`,
  ].join(', ');
}

function getTreeNodeSelector(prefix: string, targetId: string): string {
  return `[data-testid="${prefix}-node-${targetId}"]`;
}

async function waitForAdminTreeContextMenu(page: Page, timeout: number): Promise<boolean> {
  return page.locator('[data-testid="admin-tree-context-menu"]').waitFor({
    state: 'visible',
    timeout,
  }).then(() => true).catch(() => false);
}

export async function ensureAdminToolsOpen(page: Page): Promise<void> {
  const isExpanded = await page.locator('[data-testid="nav-group-admin_tools"]').getAttribute('aria-expanded');

  if (isExpanded !== 'true') {
    const clicked = await page.evaluate(() => {
      const groupButton = document.querySelector('[data-testid="nav-group-admin_tools"]') as HTMLElement | null;
      if (!groupButton) {
        return false;
      }

      groupButton.scrollIntoView({ block: 'center' });
      groupButton.click();
      return true;
    });

    if (!clicked) {
      throw new Error('Could not open admin_tools group.');
    }
  }

  await page.waitForTimeout(300);
}

export async function expandAdminTreeFolder(page: Page, folderId: string): Promise<void> {
  await ensureAdminToolsOpen(page);

  const folderNode = page.locator(getTreeNodeSelector('admin-tree', folderId)).first();
  const isExpanded = await folderNode.evaluate((node) => {
    const children = node.querySelector(':scope > [data-testid="tree-children"]') as HTMLElement | null;
    return children ? getComputedStyle(children).display !== 'none' : false;
  });

  if (!isExpanded) {
    const clicked = await page.evaluate((id) => {
      const folderToggle = document.querySelector(`[data-testid="admin-tree-folder-${id}"]`) as HTMLElement | null;
      if (!folderToggle) {
        return false;
      }

      folderToggle.scrollIntoView({ block: 'center' });
      folderToggle.click();
      return true;
    }, folderId);

    if (!clicked) {
      throw new Error(`Could not expand admin tree folder '${folderId}'.`);
    }

    await page.waitForTimeout(200);
  }
}

export async function openAdminTreeButton(page: Page, buttonId: string): Promise<void> {
  await ensureAdminToolsOpen(page);

  const clicked = await page.evaluate((id) => {
    const button = document.querySelector(`[data-testid="admin-tree-btn-${id}"]`) as HTMLElement | null;
    if (!button) {
      return false;
    }

    button.scrollIntoView({ block: 'center' });
    button.click();
    return true;
  }, buttonId);

  if (!clicked) {
    throw new Error(`Could not click admin tree button '${buttonId}'.`);
  }
}

export async function openAdminTreeContextMenu(page: Page, targetId: string): Promise<void> {
  await ensureAdminToolsOpen(page);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const opened = await page.evaluate((selector) => {
      const anchor = document.querySelector(selector) as HTMLElement | null;
      const node = anchor?.closest('[data-testid^="admin-tree-node-"]') as HTMLElement | null;
      if (!anchor || !node) {
        return false;
      }

      anchor.scrollIntoView({ block: 'center' });
      const rect = anchor.getBoundingClientRect();
      node.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + (rect.width / 2),
        clientY: rect.top + (rect.height / 2),
      }));
      return true;
    }, getAdminTreeAnchorSelector(targetId));

    if (!opened) {
      throw new Error(`Could not open admin tree context menu for '${targetId}'.`);
    }

    if (await waitForAdminTreeContextMenu(page, attempt === 0 ? 3000 : 5000)) {
      return;
    }

    await page.waitForTimeout(300);
  }

  throw new Error(`Admin tree context menu did not become visible for '${targetId}'.`);
}

export async function openNavTreeContextMenu(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const opened = await page.evaluate(() => {
      const anchor = document.querySelector('[data-testid^="nav-tree-folder-"]') as HTMLElement | null;
      const node = anchor?.closest('[data-testid^="nav-tree-node-"]') as HTMLElement | null;
      if (!anchor || !node) {
        return false;
      }

      anchor.scrollIntoView({ block: 'center' });
      const rect = anchor.getBoundingClientRect();
      node.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + (rect.width / 2),
        clientY: rect.top + (rect.height / 2),
      }));
      return true;
    });

    if (!opened) {
      throw new Error('Could not open nav tree context menu.');
    }

    if (await waitForAdminTreeContextMenu(page, attempt === 0 ? 3000 : 5000)) {
      return;
    }

    await page.waitForTimeout(300);
  }

  throw new Error('Nav tree context menu did not become visible.');
}

export async function clickAdminTreeContextMenuItem(page: Page, itemId: string): Promise<void> {
  const clicked = await page.evaluate((id) => {
    const item = document.querySelector(`[data-testid="admin-tree-menu-${id}"]`) as HTMLElement | null;
    if (!item) {
      return false;
    }

    window.setTimeout(() => item.click(), 0);
    return true;
  }, itemId);

  if (!clicked) {
    throw new Error(`Could not click admin tree context menu item '${itemId}'.`);
  }
}
