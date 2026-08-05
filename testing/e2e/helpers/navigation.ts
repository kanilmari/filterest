/**
 * navigation.ts — Navigation helpers for E2E tests.
 *
 * Provides functions to navigate to datasets and wait for content to load.
 * The app is an SPA — direct URL navigation to /tableName is NOT supported.
 * Navigation must go through the tab bar via stable tab-* data-testid anchors.
 *
 * After login, the app auto-opens the first available dataset. If the requested
 * dataset isn't available as a tab, the helper uses whatever dataset loaded by
 * default rather than failing.
 */

import { type Locator, type Page } from '@playwright/test';
import { openActiveFilterbarIfCollapsed } from './filterbar';

export type NavigateToDatasetOptions = {
  allowFallback?: boolean;
};

function buildDatasetSurfaceSelectors(tableName: string): string[] {
  return [
    `#${tableName}_tab_parts_container`,
    `#${tableName}_filterBar`,
    `#${tableName}_filterBar_panel`,
    `#${tableName}_container`,
    `#${tableName}_table_view_container`,
    `#${tableName}_card_view_container`,
    `#${tableName}_tree_view_container`,
    `#${tableName}_transposed_view_container`,
    `#${tableName}_ticket_view_container`,
    `[data-dataset-search="${tableName}"]`,
  ];
}

/**
 * Waits for the app shell to be ready (tab bar rendered with at least one tab
 * and content area present).
 */
export async function waitForAppReady(page: Page): Promise<void> {
  await page.waitForSelector('[data-testid^="tab-"]', {
    timeout: 15000,
  });
}

/**
 * Returns the first visible element for a given data-testid.
 */
export function firstVisibleByTestId(page: Page, testId: string): Locator {
  return page.locator(`[data-testid="${testId}"]:visible`).first();
}

/**
 * Clicks the first visible element matching a data-testid via DOM click().
 * This avoids Playwright pointer interception issues with fixed/overlay UI.
 */
export async function clickFirstVisibleByTestId(page: Page, testId: string): Promise<void> {
  const clicked = await page.evaluate((id) => {
    const candidates = document.querySelectorAll(`[data-testid="${id}"]`);
    for (const candidate of candidates) {
      if (!(candidate instanceof HTMLElement)) {
        continue;
      }

      const style = getComputedStyle(candidate);
      const rect = candidate.getBoundingClientRect();
      if (style.display === 'none' || style.visibility === 'hidden' || rect.width <= 0 || rect.height <= 0) {
        continue;
      }

      candidate.scrollIntoView({ block: 'center', inline: 'nearest' });
      candidate.click();
      return true;
    }

    return false;
  }, testId);

  if (!clicked) {
    throw new Error(`Could not click a visible [data-testid="${testId}"] element.`);
  }
}

/**
 * Sets a visible checkbox and dispatches the change event expected by the app.
 */
export async function setFirstVisibleCheckbox(
  page: Page,
  selector: string,
  checked = true,
): Promise<void> {
  const updated = await page.evaluate(({ checked, selector: targetSelector }) => {
    const candidates = document.querySelectorAll(targetSelector);
    for (const candidate of candidates) {
      if (!(candidate instanceof HTMLInputElement) || candidate.type !== 'checkbox') {
        continue;
      }

      const style = getComputedStyle(candidate);
      const rect = candidate.getBoundingClientRect();
      if (style.display === 'none' || style.visibility === 'hidden' || rect.width <= 0 || rect.height <= 0) {
        continue;
      }

      candidate.checked = checked;
      candidate.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }

    return false;
  }, { checked, selector });

  if (!updated) {
    throw new Error(`Could not update a visible checkbox for selector "${selector}".`);
  }
}

/**
 * Opens the add-row form through the DOM click path used by fixed toolbar controls.
 */
export async function openAddRowForm(page: Page): Promise<void> {
  await openActiveFilterbarIfCollapsed(page);
  await clickFirstVisibleByTestId(page, 'btn-add-row');
  await firstVisibleByTestId(page, 'modal-container').waitFor({ state: 'visible', timeout: 10000 });
}

/**
 * Opens one translated page inside the add-row form.
 * The helper uses the same step control a user sees and verifies the page change.
 */
export async function goToAddRowSection(page: Page, sectionLabelLangKey: string): Promise<void> {
  const form = firstVisibleByTestId(page, 'add-row-form');
  const stepButton = form
    .locator(`button[data-form-section-target][data-lang-key="${sectionLabelLangKey}"]`)
    .first();
  await stepButton.waitFor({ state: 'visible', timeout: 10000 });
  await stepButton.click();
  await page.waitForFunction(
    ({ langKey }) => {
      const activeStep = document.querySelector(
        `[data-testid="add-row-form"] button[data-lang-key="${langKey}"][aria-current="step"]`,
      );
      return Boolean(activeStep);
    },
    { langKey: sectionLabelLangKey },
    { timeout: 10000 },
  );
}

/**
 * Opens the add-row page that owns a related element, even while it is hidden.
 * This prevents relation tests from silently skipping the new paged workflow.
 */
export async function goToAddRowSectionContaining(page: Page, selector: string): Promise<void> {
  const form = firstVisibleByTestId(page, 'add-row-form');
  const sectionKey = await form.evaluate((formElement, targetSelector) => {
    const target = formElement.querySelector(targetSelector);
    const section = target?.closest('section[data-form-section]');
    return section instanceof HTMLElement ? section.dataset.sectionKey ?? null : null;
  }, selector);

  if (!sectionKey) {
    throw new Error(`Could not find an add-row form page containing "${selector}".`);
  }

  const stepButton = form.locator(`button[data-form-section-target="${sectionKey}"]`).first();
  await stepButton.waitFor({ state: 'visible', timeout: 10000 });
  await stepButton.click();
  await stepButton.waitFor({ state: 'visible', timeout: 10000 });
  await page.waitForFunction(
    ({ key }) => document.querySelector(
      `[data-testid="add-row-form"] button[data-form-section-target="${key}"][aria-current="step"]`,
    ) !== null,
    { key: sectionKey },
    { timeout: 10000 },
  );
}

/**
 * Navigates to a dataset by clicking the corresponding nav tab button.
 * The app uses `data-testid="tab-${tableName}"` for stable tab selectors.
 *
 * If the tab button is not present (table is not a top-level tab), the helper
 * fails loudly by default so tests do not silently exercise the wrong dataset.
 * Callers can opt back into the legacy fallback behavior with
 * `{ allowFallback: true }`.
 *
 * @param page       Playwright page
 * @param tableName  The dataset / table name (e.g. 'app_service_catalog', 'system_users')
 */
export async function navigateToDataset(
  page: Page,
  tableName: string,
  options: NavigateToDatasetOptions = {},
): Promise<void> {
  // Ensure the app shell is ready
  await waitForAppReady(page);
  const { allowFallback = false } = options;
  const datasetSurfaceSelectors = buildDatasetSurfaceSelectors(tableName);

  await page.waitForFunction(
    ({ datasetSurfaceSelectors, tableName }) => {
      if (document.querySelector(`[data-testid="tab-${tableName}"]`)) {
        return true;
      }
      return datasetSurfaceSelectors.some((selector) => document.querySelector(selector));
    },
    { datasetSurfaceSelectors, tableName },
    { timeout: 5000 },
  ).catch(() => false);

  // Determine which tab to open: requested dataset or first data tab
  const utilityTabs = ['user', 'logout', 'system_about'];
  const requestedTabVisible = await page
    .locator(`[data-testid="tab-${tableName}"]`)
    .first()
    .isVisible({ timeout: 3000 })
    .catch(() => false);

  if (!requestedTabVisible && !allowFallback) {
    throw new Error(
      `Requested dataset tab "${tableName}" was not available. ` +
      'Use navigateToDefaultDataset() or pass { allowFallback: true } only when fallback is intentional.',
    );
  }

  if (requestedTabVisible) {
    await page.locator(`[data-testid="tab-${tableName}"]`).first().evaluate((button) => {
      if (button instanceof HTMLElement) {
        button.click();
      }
    });

    await page.waitForSelector('.scrollable_content', {
      state: 'attached',
      timeout: 15000,
    });
    return;
  }

  const requestedDatasetAlreadyLoaded = await page.evaluate(
    (selectors) => selectors.some((selector) => document.querySelector(selector)),
    datasetSurfaceSelectors,
  );

  if (requestedDatasetAlreadyLoaded) {
    await page.waitForSelector('.scrollable_content', {
      state: 'attached',
      timeout: 15000,
    });
    return;
  }

  const targetId = await page.evaluate(
    ({ tableName, utilityTabs, allowFallback }) => {
      // Try the requested tab first
      const exactByTestId = document.querySelector(
        `[data-testid="tab-${tableName}"]`,
      );
      if (exactByTestId) return tableName;
      if (!allowFallback) return null;
      // Fall back to first non-utility data tab
      const all = document.querySelectorAll(
        '[data-testid^="tab-"]',
      );
      for (const btn of all) {
        const id = (btn as HTMLElement).dataset.id;
        if (id && !utilityTabs.includes(id)) return id;
      }
      // Last resort — any tab
      const first = document.querySelector(
        '[data-testid^="tab-"]',
      );
      return first ? (first as HTMLElement).dataset.id ?? null : null;
    },
    { tableName, utilityTabs, allowFallback },
  );

  if (targetId) {
    // Call the native click handler via JS DOM click()
    await page.evaluate((id) => {
      const btn = document.querySelector(
        `[data-testid="tab-${id}"]`,
      ) as HTMLElement | null;
      if (btn) btn.click();
    }, targetId);
  } else {
    throw new Error(`Could not resolve a dataset tab to open for "${tableName}".`);
  }

  // Wait for the content area to render after tab click
  await page.waitForSelector('.scrollable_content', {
    state: 'attached',
    timeout: 15000,
  });
}

/**
 * Navigates to the first available (default) dataset.
 * After login the app auto-selects the first tab, so this just waits for
 * the content to appear.
 */
export async function navigateToDefaultDataset(page: Page): Promise<void> {
  await waitForAppReady(page);

  // Click the first data tab to load content via JS DOM click()
  const utilityTabs = ['user', 'logout', 'system_about'];
  await page.evaluate((skip) => {
    const all = document.querySelectorAll(
      '[data-testid^="tab-"]',
    );
    for (const btn of all) {
      const id = (btn as HTMLElement).dataset.id;
      if (id && !skip.includes(id)) {
        (btn as HTMLElement).click();
        return;
      }
    }
    // Last resort
    const first = document.querySelector(
      '[data-testid^="tab-"]',
    ) as HTMLElement | null;
    if (first) first.click();
  }, utilityTabs);

  await page.waitForSelector('.scrollable_content', {
    state: 'attached',
    timeout: 15000,
  });
}

/**
 * Waits for table data to be loaded (rows visible in table or cards rendered).
 * If no specific data selectors appear within the timeout, it still succeeds
 * as long as the content container is present (the dataset might be empty).
 */
export async function waitForDataLoaded(page: Page, _tableName?: string): Promise<void> {
  // Wait for the scrollable content container to exist
  await page.waitForSelector('.scrollable_content', {
    state: 'attached',
    timeout: 15000,
  });
  // Give data a moment to render after the container appears
  await page.waitForTimeout(500);
}
