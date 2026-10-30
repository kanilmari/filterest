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

import { expect, type Locator, type Page } from '@playwright/test';
import {
  closeActiveFilterbarIfOpen,
  isVisibleWithin,
  openActiveFilterbarIfCollapsed,
  revealActiveFilterbarSection,
  waitForActiveFilterbarLayout,
} from './filterbar';
import { getActiveDatasetContainer } from './active-dataset';

export type CardView = 'normal' | 'big';
export type ViewMode = 'table' | 'card' | 'article_view' | 'normal' | 'tree' | 'transposed' | 'ticket' | 'settings';
export type SwitchToViewOptions = {
  allowMissing?: boolean;
};

/** Maps viewKey → stable data-testid for direct view buttons */
const DIRECT_VIEW_TEST_IDS: Partial<Record<ViewMode, string>> = {
  table: 'view-btn-table',
  card: 'view-btn-card',
  article_view: 'view-btn-article_view',
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
  article_view: 'article_view_container',
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
async function isRequestedViewSurfaceActive(container: Locator, viewMode: ViewMode): Promise<boolean> {
  return container.evaluate((activeTableParts, surfaceSuffix) => {
    const containerStyle = getComputedStyle(activeTableParts);
    if (containerStyle.display === 'none' || containerStyle.visibility === 'hidden'
      || activeTableParts.getClientRects().length === 0) return false;
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

/** Opens the shared view-selector disclosure when the current UI keeps tool groups collapsed. */
async function openViewSelectorSectionIfCollapsed(page: Page, container: Locator): Promise<void> {
  const section = container.locator('.dataset-filter-views-section:visible').first();
  if (!await isVisibleWithin(section, 2000)) {
    return;
  }
  if (!await section.evaluate((element) => element.classList.contains('is-collapsed'))) {
    return;
  }

  await revealActiveFilterbarSection(page, 'views', container);
  await expect(section).not.toHaveClass(/\bis-collapsed\b/, { timeout: 5000 });
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
  const container = await getActiveDatasetContainer(page);
  await container.evaluate((parts) => {
    const candidates = Array.from(parts.querySelectorAll('.scrollable_content')) as HTMLElement[];
    const activeContainer = candidates.find((element) => {
      const style = window.getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
    });

    if (activeContainer) {
      activeContainer.scrollTop = 0;
    }
    window.scrollTo(0, 0);
  });

  if (await isRequestedViewSurfaceActive(container, viewMode)) {
    return;
  }

  await waitForActiveFilterbarLayout(page, container, { allowMissingPanel: true });
  const openedFilterbarForSwitch = await openActiveFilterbarIfCollapsed(page, container);

  try {
    await openViewSelectorSectionIfCollapsed(page, container);
    const directTestId = DIRECT_VIEW_TEST_IDS[viewMode];
    if (directTestId) {
      const btnByTestId = container.locator(`[data-testid="${directTestId}"]:visible`).first();
      if (await isVisibleWithin(btnByTestId, 3000)) {
        await btnByTestId.scrollIntoViewIfNeeded();
        await btnByTestId.click({ timeout: 5000 });
        await expect.poll(
          () => isRequestedViewSurfaceActive(container, viewMode),
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
      const dropdownContainer = container.locator('[data-testid="view-dropdown-more"]:visible').first();
      if (await isVisibleWithin(dropdownContainer, 3000)) {
        // VanillaDropdown portals its menu to body and closes it on a document click outside it, but its trigger
        // stops propagation, so a menu another dataset left open would stay open. Close every open menu first, so
        // the scoped trigger opens the only visible one.
        const menuSelector = '[data-testid="view-dropdown-more-list"]:visible';
        if (await page.locator(menuSelector).count() > 0) {
          await page.evaluate(() => document.body.dispatchEvent(new MouseEvent('click', { bubbles: true })));
        }
        const trigger = dropdownContainer.locator('[data-testid="view-dropdown-more-trigger"]:visible').first();
        if (await isVisibleWithin(trigger, 2000)) {
          await trigger.scrollIntoViewIfNeeded();
          await trigger.click({ timeout: 5000 });
        }
        // Exactly one visible menu now: the one the requested dataset's trigger opened.
        const openMenus = page.locator(menuSelector);
        const option = openMenus.getByTestId(dropdownOptionTestId);
        if (await openMenus.count() === 1 && await isVisibleWithin(option, 3000)) {
          await option.scrollIntoViewIfNeeded();
          await option.click({ timeout: 5000 });
          await expect.poll(
            () => isRequestedViewSurfaceActive(container, viewMode),
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
      await closeActiveFilterbarIfOpen(page, container);
    }
  }
}

/**
 * Opens a big card view by clicking on the first card in the card view.
 * Returns true if the big card was opened, false if no cards are available.
 *
 * This is for specs that run on data they do not own (C2, C3, E10, E11): they
 * take whichever card comes first. C2 and C3 skip when it returns false; E10
 * and E11 require it to open. A spec that
 * creates its own dataset opens a known row instead, with
 * openTempDatasetRowArticle (temp-dataset.ts): a person-like pointer click
 * that also proves nothing covers the card, and that opens a card without a
 * header field from its "Show more" button. This helper's script click proves
 * neither. Moving these specs to the pointer click would change what they
 * test, so it is left as a decision of its own rather than done in passing.
 */
export async function openBigCard(page: Page): Promise<boolean> {
  const bigCard = page.locator('[data-testid="big-card-container"]').first();
  if (await isVisibleWithin(bigCard, 1000)) {
    await page.waitForTimeout(750);
    return true;
  }

  const cardHeader = page.locator('[data-testid="card-item-header"]').first();
  if (await isVisibleWithin(cardHeader, 5000)) {
    await cardHeader.scrollIntoViewIfNeeded().catch(() => {});

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await cardHeader.evaluate((element) => {
        (element as HTMLElement).click();
      });

      if (await isVisibleWithin(bigCard, 3000)) {
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
 * Closes the open article through its visible chrome and verifies dismissal.
 * The shared top bar owns the close control in the ordinary article layout;
 * its hidden in-article counterpart remains available to other layouts.
 */
export async function closeBigCard(page: Page): Promise<void> {
  const closeButton = page.locator(
    '[data-testid="shared-topbar-article-close"]:visible, [data-testid="big-card-close"]:visible',
  ).first();
  await expect(closeButton).toBeVisible({ timeout: 5000 });
  await closeButton.click();
  await expect(page.locator('[data-testid="big-card-container"]:visible'))
    .toHaveCount(0, { timeout: 5000 });
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
