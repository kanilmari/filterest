/**
 * view-switch.ts — View switching helpers for E2E tests.
 *
 * Handles switching between card view, big card view, table view, etc.
 * Used by the Playwright matrix to set up the correct view before each test.
 *
 * Direct view buttons expose stable `view-btn-*` data-testid anchors.
 * Dropdown views (tree/ticket/settings) live inside the `view-dropdown-more`
 * VanillaDropdown wrapper.
 *
 * See source: frontend/reusable_components/filterbar/admin_buttons/create_admin_buttons.js
 */

import { expect, type Page } from '@playwright/test';
import {
  closeActiveFilterbarIfOpen,
  openActiveFilterbarIfCollapsed,
} from './filterbar';

export type CardView = 'normal' | 'big';
export type ViewMode = 'table' | 'card' | 'normal' | 'tree' | 'transposed' | 'ticket' | 'settings';
export type SwitchToViewOptions = {
  allowMissing?: boolean;
};

/** Maps viewKey → stable data-testid for direct view buttons */
const DIRECT_VIEW_TEST_IDS: Partial<Record<ViewMode, string>> = {
  table: 'view-btn-table',
  card: 'view-btn-card',
  normal: 'view-btn-normal',
  transposed: 'view-btn-transposed',
};

/** Maps viewKey → stable data-testid for dropdown-only views */
const DROPDOWN_VIEW_TEST_IDS: Partial<Record<ViewMode, string>> = {
  tree: 'view-dropdown-more-option-tree',
  ticket: 'view-dropdown-more-option-ticket',
  settings: 'view-dropdown-more-option-settings',
};

/** Maps a requested view to the render container suffix that proves it is already active. */
const VIEW_SURFACE_SUFFIXES: Record<ViewMode, string> = {
  table: 'table_view_container',
  card: 'card_view_container',
  normal: 'normal_view_container',
  tree: 'tree_view_container',
  transposed: 'transposed_view_container',
  ticket: 'ticket_view_container',
  settings: 'settings_view_container',
};

/**
 * Detects whether the requested view's rendered container is already visible.
 * Bridges permission-limited selector controls and the actual active dataset surface.
 * Exists so tests can accept an already-correct view without requiring a redundant button.
 */
async function isRequestedViewSurfaceActive(page: Page, viewMode: ViewMode): Promise<boolean> {
  return page.evaluate((surfaceSuffix) => {
    const activeTableParts = Array.from(
      document.querySelectorAll('.tab_parts_container'),
    ).find((candidate) => {
      if (!(candidate instanceof HTMLElement)) {
        return false;
      }
      const style = getComputedStyle(candidate);
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && candidate.getClientRects().length > 0;
    });

    if (!(activeTableParts instanceof HTMLElement)) {
      return false;
    }

    const tablePartsSuffix = '_tab_parts_container';
    if (!activeTableParts.id.endsWith(tablePartsSuffix)) {
      return false;
    }

    const datasetName = activeTableParts.id.slice(0, -tablePartsSuffix.length);
    const requestedSurface = document.getElementById(`${datasetName}_${surfaceSuffix}`);
    if (!(requestedSurface instanceof HTMLElement) || !activeTableParts.contains(requestedSurface)) {
      return false;
    }

    const style = getComputedStyle(requestedSurface);
    return style.display !== 'none'
      && style.visibility !== 'hidden'
      && requestedSurface.getClientRects().length > 0;
  }, VIEW_SURFACE_SUFFIXES[viewMode]);
}

/**
 * Switches to the specified view mode using the view selector buttons.
 *
 * For direct views (table/card/normal/transposed): clicks the matching
 * `view-btn-*` button.
 *
 * For dropdown views (tree/ticket/settings): opens the custom view dropdown
 * trigger and selects the matching option.
 *
 * By default, missing view controls are treated as failures so tests do not
 * silently pass while exercising the wrong view. Callers can opt back into the
 * legacy silent behavior with `{ allowMissing: true }`.
 */
export async function switchToView(
  page: Page,
  viewMode: ViewMode,
  options: SwitchToViewOptions = {},
): Promise<void> {
  const { allowMissing = false } = options;
  await page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll('.scrollable_content')) as HTMLElement[];
    const activeContainer = candidates.find((element) => {
      const style = window.getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
    });

    if (activeContainer) {
      activeContainer.scrollTop = 0;
    }
    window.scrollTo(0, 0);
  });

  if (await isRequestedViewSurfaceActive(page, viewMode)) {
    return;
  }

  const openedFilterbarForSwitch = await openActiveFilterbarIfCollapsed(page);

  try {
    const directTestId = DIRECT_VIEW_TEST_IDS[viewMode];
    if (directTestId) {
      const btnByTestId = page.locator(`[data-testid="${directTestId}"]:visible`).first();
      if (await btnByTestId.isVisible({ timeout: 3000 }).catch(() => false)) {
        await btnByTestId.scrollIntoViewIfNeeded();
        await btnByTestId.click({ timeout: 5000 });
        await expect.poll(
          () => isRequestedViewSurfaceActive(page, viewMode),
          { timeout: 5000 },
        ).toBe(true);
        return;
      }
      if (!allowMissing) {
        throw new Error(`Required direct view control "${viewMode}" was not visible.`);
      }
      return;
    }

    const dropdownOptionTestId = DROPDOWN_VIEW_TEST_IDS[viewMode];
    if (dropdownOptionTestId) {
      const dropdownContainer = page.locator('[data-testid="view-dropdown-more"]:visible').first();
      if (await dropdownContainer.isVisible({ timeout: 3000 }).catch(() => false)) {
        const trigger = page.locator('[data-testid="view-dropdown-more-trigger"]:visible').first();
        if (await trigger.isVisible({ timeout: 2000 }).catch(() => false)) {
          await trigger.scrollIntoViewIfNeeded();
          await trigger.click({ timeout: 5000 });
        }
        const option = page.locator(`[data-testid="${dropdownOptionTestId}"]:visible`).first();
        if (await option.isVisible({ timeout: 3000 }).catch(() => false)) {
          await option.scrollIntoViewIfNeeded();
          await option.click({ timeout: 5000 });
          await expect.poll(
            () => isRequestedViewSurfaceActive(page, viewMode),
            { timeout: 5000 },
          ).toBe(true);
          return;
        }
      }
      if (!allowMissing) {
        throw new Error(`Required dropdown view control "${viewMode}" was not visible.`);
      }
      return;
    }

    if (!allowMissing) {
      throw new Error(`Unsupported or unavailable view mode "${viewMode}".`);
    }
  } finally {
    if (openedFilterbarForSwitch) {
      await closeActiveFilterbarIfOpen(page);
    }
  }
}

/**
 * Opens a big card view by clicking on the first card in the card view.
 * Returns true if the big card was opened, false if no cards are available.
 */
export async function openBigCard(page: Page): Promise<boolean> {
  const bigCard = page.locator('[data-testid="big-card-container"]').first();
  if (await bigCard.isVisible({ timeout: 1000 }).catch(() => false)) {
    await page.waitForTimeout(750);
    return true;
  }

  const cardHeader = page.locator('[data-testid="card-item-header"]').first();
  if (await cardHeader.isVisible({ timeout: 5000 }).catch(() => false)) {
    await cardHeader.scrollIntoViewIfNeeded().catch(() => {});

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await cardHeader.evaluate((element) => {
        (element as HTMLElement).click();
      });

      if (await bigCard.isVisible({ timeout: 3000 }).catch(() => false)) {
        await page.waitForTimeout(750);
        return true;
      }

      await page.waitForTimeout(250);
    }

    await expect(bigCard).toBeVisible({
      timeout: 5000,
    });
    return true;
  }
  return false;
}

/**
 * Closes the big card view if open.
 */
export async function closeBigCard(page: Page): Promise<void> {
  const closeButton = page.locator('[data-testid="big-card-close"]').first();
  if (await closeButton.isVisible({ timeout: 3000 }).catch(() => false)) {
    await closeButton.click();
  }
  await page.waitForTimeout(500);
}

/**
 * Sets up the correct card view for the test matrix.
 * Called by beforeEach based on the Playwright project's cardView setting.
 */
export async function setupCardView(page: Page, cardView: CardView): Promise<void> {
  if (cardView === 'big') {
    await switchToView(page, 'card');
    await openBigCard(page);
  } else {
    await switchToView(page, 'card');
  }
}
