/**
 * filterbar.ts
 * Opens the active dataset filterbar only when its responsive panel is collapsed.
 * Bridges Playwright helpers and the filterbar's stable panel/toggle DOM contract.
 * Exists so mobile and desktop E2E actions can reach controls without toggling an open panel closed.
 */

import { expect, type Locator, type Page } from '@playwright/test';

function buildFilterTestIdSegment(value: string): string {
  return String(value ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown';
}

function getActiveTableParts(page: Page): Locator {
  return page.locator('.tab_parts_container:visible').first();
}

/**
 * Opens the active dataset's collapsed filterbar and waits for its panel to become available.
 * Bridges responsive panel state and E2E helpers that need toolbar or view controls.
 * Exists to centralize the idempotent mobile-safe disclosure step.
 */
export async function openActiveFilterbarIfCollapsed(page: Page): Promise<boolean> {
  const activeTableParts = getActiveTableParts(page);
  if ((await activeTableParts.count()) === 0) {
    return false;
  }

  const panel = activeTableParts.locator('.filterbar-panel').first();
  if ((await panel.count()) === 0) {
    return false;
  }
  const panelClass = await panel.getAttribute('class');
  if (!panelClass?.split(/\s+/).includes('filterbar-panel--hidden')) {
    return false;
  }

  const toggle = activeTableParts.locator('[data-testid="filterbar-toggle"]:visible').first();
  await expect(toggle).toBeVisible({ timeout: 5000 });
  await expect(toggle).toHaveAttribute('aria-hidden', 'false', { timeout: 5000 });
  await expect(toggle).toBeEnabled({ timeout: 5000 });

  await toggle.click({ timeout: 5000 });
  await expect(panel).not.toHaveClass(
    /(?:^|\s)filterbar-panel--hidden(?:\s|$)/,
    { timeout: 5000 },
  );
  return true;
}

/**
 * Closes the active dataset filterbar through its visible in-panel control.
 * Bridges temporary helper-opened panels and the responsive state expected by surface interactions.
 * Exists so shared navigation can restore a previously collapsed mobile panel without changing desktop state.
 */
export async function closeActiveFilterbarIfOpen(page: Page): Promise<boolean> {
  const activeTableParts = getActiveTableParts(page);
  if ((await activeTableParts.count()) === 0) {
    return false;
  }

  const panel = activeTableParts.locator('.filterbar-panel').first();
  if ((await panel.count()) === 0) {
    return false;
  }
  const panelClass = await panel.getAttribute('class');
  if (panelClass?.split(/\s+/).includes('filterbar-panel--hidden')) {
    return false;
  }

  const hideButton = panel.locator('.hide_filter_bar_button:visible').first();
  await expect(hideButton).toBeVisible({ timeout: 5000 });
  await expect(hideButton).toBeEnabled({ timeout: 5000 });
  await hideButton.click({ timeout: 5000 });
  await expect(panel).toHaveClass(
    /(?:^|\s)filterbar-panel--hidden(?:\s|$)/,
    { timeout: 5000 },
  );
  return true;
}

/**
 * Opens one known dataset-column accordion and returns its stable filter row.
 * Bridges exact dataset/column metadata with responsive filterbar disclosure controls.
 * Exists so filter tests do not depend on whichever accordion happened to be open first.
 */
export async function openColumnFilterAccordion(
  page: Page,
  datasetName: string,
  columnName: string,
): Promise<Locator> {
  await openActiveFilterbarIfCollapsed(page);

  const activeTableParts = getActiveTableParts(page);
  const rowTestId =
    `column-filter-row-${buildFilterTestIdSegment(datasetName)}-${buildFilterTestIdSegment(columnName)}`;
  const row = activeTableParts.locator(`[data-testid="${rowTestId}"]`).first();
  await expect(row).toBeAttached({ timeout: 5000 });

  const filtersDisclosure = row.locator(
    'xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " favefox-filterbar-wrapper ") and contains(concat(" ", normalize-space(@class), " "), " filterbar-disclosure-section ")][1]',
  );
  if ((await filtersDisclosure.count()) > 0) {
    const disclosureClass = await filtersDisclosure.getAttribute('class');
    if (!disclosureClass?.split(/\s+/).includes('is-expanded')) {
      const disclosureHeading = filtersDisclosure.locator(':scope > .filterbar-section-heading').first();
      await expect(disclosureHeading).toBeVisible({ timeout: 5000 });
      await disclosureHeading.click({ timeout: 5000 });
      await expect(filtersDisclosure).toHaveClass(/(?:^|\s)is-expanded(?:\s|$)/, {
        timeout: 5000,
      });
    }
  }

  if (await row.isVisible()) {
    return row;
  }

  const columnSection = row.locator(
    'xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " filter-section ")][1]',
  );
  const toggle = columnSection.locator('.toggle-filters-button').first();
  await expect(toggle).toBeVisible({ timeout: 5000 });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await toggle.click({ timeout: 5000 });
  }
  await expect(toggle).toHaveAttribute('aria-expanded', 'true', { timeout: 5000 });
  await expect(row).toBeVisible({ timeout: 5000 });
  return row;
}
