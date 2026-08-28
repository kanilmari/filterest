/**
 * T7_card_visibility.spec.ts
 *
 * E2E test for the Card Visibility admin view.
 * Full flow: navigate → select table → edit flags → save → reload → verify persistence.
 *
 * Admin tools tree structure (render_mode='button'):
 *   table_tools (folder, open by default at level 0)
 *     └─ card_visibility (leaf button, class: general_button_admin)
 *
 * Card visibility view DOM:
 *   #cv_table_selector_tree — checkbox tree (left panel) — fires checkboxSelectionChanged
 *   #cv_matrix_container    — vanilla_checkbox_table mount point
 *   editButton              — .vct-btn-edit with data-testid bridge
 *   saveButton              — .vct-btn-save with data-testid bridge
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { expandAdminTreeFolder, openAdminTreeButton } from '../helpers/admin-navigation';
import { waitForAppReady } from '../helpers/navigation';
import {
  buildTempDatasetName,
  createTempDataset,
  dropTempDataset,
} from '../helpers/temp-dataset';

type E2EPage = import('@playwright/test').Page;

async function ensureNavbarVisible(page: E2EPage): Promise<void> {
  const opened = await page.evaluate(() => {
    const navbar = document.getElementById('navbar');
    if (!navbar) {
      return false;
    }
    if (!navbar.classList.contains('collapsed')) {
      return true;
    }

    const showMenuButton = document.getElementById('showMenuButton') as HTMLButtonElement | null;
    if (!showMenuButton) {
      return false;
    }

    showMenuButton.click();
    return true;
  });

  if (!opened) {
    throw new Error('Could not open the navbar before navigating to card visibility.');
  }

  await page.waitForFunction(() => {
    const navbar = document.getElementById('navbar');
    return navbar instanceof HTMLElement && !navbar.classList.contains('collapsed');
  }, { timeout: 5000 });
}

async function clickCardVisibilityButton(page: E2EPage, testId: string): Promise<void> {
  const clicked = await page.evaluate((targetTestId) => {
    const button = document.querySelector(`[data-testid="${targetTestId}"]`) as HTMLButtonElement | null;
    if (!button) {
      return false;
    }

    button.scrollIntoView({ block: 'center', inline: 'center' });
    button.click();
    return true;
  }, testId);

  if (!clicked) {
    throw new Error(`Could not click card visibility button "${testId}".`);
  }
}

async function refreshCachedTreeData(page: E2EPage): Promise<void> {
  const refreshed = await page.evaluate(async () => {
    const response = await fetch('/api/tree_data', {
      credentials: 'include',
    });
    if (!response.ok) {
      return false;
    }

    const treeData = await response.json();
    localStorage.setItem('full_tree_data', JSON.stringify(treeData));
    return true;
  });

  if (!refreshed) {
    throw new Error('Could not refresh localStorage.full_tree_data for card visibility.');
  }
}

async function setTableSelectorSearch(page: E2EPage, searchTerm = ''): Promise<void> {
  const searchInput = page
    .locator('#cv_table_selector_tree input[type="text"], #cv_table_selector_tree input[type="search"]')
    .first();

  if (!(await searchInput.isVisible({ timeout: 2000 }).catch(() => false))) {
    return;
  }

  await searchInput.fill(searchTerm);
  await page.waitForTimeout(searchTerm ? 300 : 150);
}

async function readFirstEditableCheckboxState(
  page: E2EPage,
  expectedColumns: string[],
): Promise<boolean> {
  const checked = await page.evaluate((columns) => {
    const roots = Array.from(document.querySelectorAll('#cv_matrix_container .vct-root')) as HTMLElement[];
    const matchingRoot = [...roots].reverse().find((root) => {
      const text = root.textContent || '';
      return columns.every((columnName) => text.includes(columnName));
    });
    const checkbox = matchingRoot?.querySelector('.vct-input-checkbox') as HTMLInputElement | null;
    return checkbox?.checked ?? null;
  }, expectedColumns);

  if (typeof checked !== 'boolean') {
    throw new Error('Could not read the first editable card visibility checkbox.');
  }

  return checked;
}

async function toggleFirstEditableCheckbox(
  page: E2EPage,
  expectedColumns: string[],
): Promise<boolean> {
  const originalChecked = await page.evaluate((columns) => {
    const roots = Array.from(document.querySelectorAll('#cv_matrix_container .vct-root')) as HTMLElement[];
    const matchingRoot = [...roots].reverse().find((root) => {
      const text = root.textContent || '';
      return columns.every((columnName) => text.includes(columnName));
    });
    const checkbox = matchingRoot?.querySelector('.vct-input-checkbox') as HTMLInputElement | null;
    if (!checkbox) {
      return null;
    }

    checkbox.scrollIntoView({ block: 'center', inline: 'center' });
    const originalValue = checkbox.checked;
    checkbox.click();
    return originalValue;
  }, expectedColumns);

  if (typeof originalChecked !== 'boolean') {
    throw new Error('Could not toggle the first editable card visibility checkbox.');
  }

  return originalChecked;
}
// ---------------------------------------------------------------------------
// Helper: navigate to the card_visibility admin view
// ---------------------------------------------------------------------------
async function navigateToCardVisibility(page: E2EPage): Promise<void> {
  await ensureNavbarVisible(page);
  await expandAdminTreeFolder(page, 'table_tools');
  await openAdminTreeButton(page, 'card_visibility');

  // Wait for the view container to render
  await expect(page.locator('#card_visibility_container')).toBeVisible({ timeout: 10000 });
}

// ---------------------------------------------------------------------------
// Helper: select a table in the cv_table_selector_tree
// ---------------------------------------------------------------------------
async function selectFirstTable(
  page: E2EPage,
  preferredTableName?: string,
): Promise<string> {
  await expect(page.locator('#cv_table_selector_tree')).toBeVisible({ timeout: 5000 });
  await setTableSelectorSearch(page, preferredTableName?.trim() || '');

  // The tree restores a previous single-selection from localStorage.
  // Clicking an already-selected radio does not emit a new change event, so we
  // intentionally pick the first visible unchecked dataset leaf when possible.
  const selectedTableName = await page.evaluate((targetTableName) => {
    const tree = document.getElementById('cv_table_selector_tree');
    if (!tree) return null;

    const childrenDivs = tree.querySelectorAll('.children') as NodeListOf<HTMLElement>;
    for (const childDiv of childrenDivs) {
      childDiv.hidden = false;
      childDiv.style.height = 'auto';
      childDiv.style.overflow = 'visible';
      if (childDiv.dataset.collapsibleState) {
        childDiv.dataset.collapsibleState = 'expanded';
      }
    }

    const leafNodes = Array.from(
      tree.querySelectorAll('.node[data-is-folder="false"][data-table-uid]'),
    ) as HTMLElement[];

    const getNodeTableName = (node: HTMLElement) => {
      const label = node.querySelector('span[data-lang-key], button[data-lang-key]') as HTMLElement | null;
      return label?.getAttribute('data-lang-key')?.trim() || label?.textContent?.trim() || '';
    };

    const findCandidate = (preferUnchecked: boolean, exactTableName = '') => leafNodes.find((node) => {
      // Skip visibility check when targeting a specific table (we already expanded all folders)
      if (!exactTableName && node.getClientRects().length === 0) return false;
      const radio = node.querySelector('input[type="radio"]') as HTMLInputElement | null;
      if (!radio) return false;
      if (exactTableName && getNodeTableName(node) !== exactTableName) return false;
      return preferUnchecked ? !radio.checked : true;
    });

    const normalizedTarget = typeof targetTableName === 'string' ? targetTableName.trim() : '';
    const targetNode = normalizedTarget
      ? (
        findCandidate(true, normalizedTarget) ||
        findCandidate(false, normalizedTarget)
      )
      : (
        findCandidate(true) ||
        findCandidate(false)
      );
    if (!targetNode) return null;

    const row = targetNode.querySelector(':scope > .node-row') as HTMLElement | null;
    const radio = targetNode.querySelector('input[type="radio"]') as HTMLInputElement | null;
    const label = targetNode.querySelector('span[data-lang-key], button[data-lang-key]') as HTMLElement | null;

    row?.scrollIntoView({ block: 'center' });
    if (radio?.checked) {
      radio.checked = false;
    }
    radio?.click();

    return label?.getAttribute('data-lang-key')?.trim() || label?.textContent?.trim() || null;
  }, preferredTableName);

  expect(selectedTableName).toBeTruthy();

  // Wait for API response → checkbox table mounts inside matrix container
  await page.waitForFunction(
    () => {
      const el = document.getElementById('cv_matrix_container');
      return el && el.querySelector('.vct-root') !== null;
    },
    { timeout: 15000 }
  );

  return selectedTableName!;
}

async function selectAnotherTable(page: E2EPage, excludedTableName: string): Promise<string> {
  await expect(page.locator('#cv_table_selector_tree')).toBeVisible({ timeout: 5000 });
  await setTableSelectorSearch(page, '');

  const selectedTableName = await page.evaluate((excludedName) => {
    const tree = document.getElementById('cv_table_selector_tree');
    if (!tree) return null;

    const leafNodes = Array.from(
      tree.querySelectorAll('.node[data-is-folder="false"][data-table-uid]'),
    ) as HTMLElement[];

    const getNodeTableName = (node: HTMLElement) => {
      const label = node.querySelector('span[data-lang-key], button[data-lang-key]') as HTMLElement | null;
      return label?.getAttribute('data-lang-key')?.trim() || label?.textContent?.trim() || '';
    };

    const findCandidate = (preferUnchecked: boolean) => leafNodes.find((node) => {
      if (node.classList.contains('hidden') || node.getClientRects().length === 0) return false;
      const tableName = getNodeTableName(node);
      if (!tableName || tableName === excludedName) return false;
      const radio = node.querySelector('input[type="radio"]') as HTMLInputElement | null;
      if (!radio) return false;
      return preferUnchecked ? !radio.checked : true;
    });

    const targetNode = findCandidate(true) || findCandidate(false);
    if (!targetNode) return null;

    const row = targetNode.querySelector(':scope > .node-row') as HTMLElement | null;
    const radio = targetNode.querySelector('input[type="radio"]') as HTMLInputElement | null;
    const label = targetNode.querySelector('span[data-lang-key], button[data-lang-key]') as HTMLElement | null;

    row?.scrollIntoView({ block: 'center' });
    radio?.click();

    return label?.getAttribute('data-lang-key')?.trim() || label?.textContent?.trim() || null;
  }, excludedTableName);

  expect(selectedTableName).toBeTruthy();
  expect(selectedTableName).not.toBe(excludedTableName);

  return selectedTableName!;
}

async function waitForMatrixColumns(page: E2EPage, expectedColumns: string[]): Promise<void> {
  await page.waitForFunction((columns) => {
    const roots = Array.from(document.querySelectorAll('#cv_matrix_container .vct-root')) as HTMLElement[];
    return [...roots].reverse().some((root) => {
      const text = root.textContent || '';
      return columns.every((columnName) => text.includes(columnName));
    });
  }, expectedColumns, { timeout: 10000 });

  for (const columnName of expectedColumns) {
    await expect(page.locator('#cv_matrix_container .vct-row').filter({ hasText: columnName }).last()).toBeAttached({
      timeout: 10000,
    });
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
test.describe('T7 — Card Visibility Admin View', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    page.on('console', (msg) => {
      if (msg.type() === 'error') console.log(`BROWSER ERROR: ${msg.text()}`);
    });
    await login(page, credentials);
    // Wait for the app shell (tab bar) before navigating
    await waitForAppReady(page);
  });

  // -----------------------------------------------------------------------
  test('can navigate to card visibility view and see placeholder', async ({ page }) => {
    await navigateToCardVisibility(page);

    // Verify the table selector tree exists (wait longer for tree to render)
    await expect(page.locator('#cv_table_selector_tree')).toBeVisible({ timeout: 10000 });

    // Verify the placeholder message (no table selected yet)
    // The placeholder is hardcoded Finnish text inside #cv_matrix_container .cv-instructions
    const placeholder = page.locator('#cv_matrix_container .cv-instructions');
    await expect(placeholder).toBeVisible({ timeout: 5000 });
  });

  // -----------------------------------------------------------------------
  test('selecting a table loads the visibility matrix', async ({ page }) => {
    await navigateToCardVisibility(page);
    const selectedTableName = await selectFirstTable(page);

    const matrix = page.locator('#cv_matrix_container');

    // Vanilla checkbox table root should be mounted even when narrow layouts
    // leave most of the matrix outside the visible viewport.
    await expect(matrix.locator('.vct-root')).toHaveCount(1, { timeout: 3000 });

    // The visibility flags are runtime-defined and can grow as card metadata evolves.
    // Verify the stable static header and the matrix shape instead of pinning a stale count.
    const headers = matrix.locator('thead th');
    const headerCount = await headers.count();
    await expect(headers.first()).toHaveClass(/cv-column-name/);
    expect(headerCount).toBeGreaterThan(1);
    expect(headerCount).toBe(await matrix.locator('.vct-row').first().locator('td').count());

    // Data rows (.vct-row) — one per database column in the selected table
    const rowCount = await matrix.locator('.vct-row').count();
    expect(rowCount).toBeGreaterThan(0);

    // Read-only checkbox indicators should be present outside edit mode.
    const indicatorCells = matrix.locator('.vct-checkbox-indicator');
    expect(await indicatorCells.count()).toBeGreaterThan(0);
  });

  // -----------------------------------------------------------------------
  test('full edit → save → reload → verify persistence', async ({ page }) => {
    const datasetName = buildTempDatasetName(`e2e_card_visibility_${test.info().project.name}`);
    const expectedColumns = ['e2e_cv_title', 'e2e_cv_summary', 'e2e_cv_active'];

    await createTempDataset(page, {
      datasetName,
      columns: {
        id: 'SERIAL',
        e2e_cv_title: 'TEXT',
        e2e_cv_summary: 'TEXT',
        e2e_cv_active: 'BOOLEAN',
      },
    });
    await refreshCachedTreeData(page);

    try {
      await navigateToCardVisibility(page);
      const selectedTableName = await selectFirstTable(page, datasetName);
      expect(selectedTableName).toBe(datasetName);
      await waitForMatrixColumns(page, expectedColumns);

      const matrix = page.locator('#cv_matrix_container');

      // --- Enter edit mode ---
      await page.waitForSelector('[data-testid="card-visibility-edit-button"]', {
        state: 'attached',
        timeout: 3000,
      });
      await clickCardVisibilityButton(page, 'card-visibility-edit-button');
      await page.waitForTimeout(300);

      // Verify editable checkboxes appeared in the matrix
      const editCheckboxes = matrix.locator('.vct-input-checkbox');
      const editCount = await editCheckboxes.count();
      expect(editCount).toBeGreaterThan(0);

      // --- Toggle the first checkbox ---
      const originalChecked = await toggleFirstEditableCheckbox(page, expectedColumns);
      expect(await readFirstEditableCheckboxState(page, expectedColumns)).toBe(!originalChecked);

      // --- Save changes ---
      const saveBtn = page.locator('[data-testid="card-visibility-save-button"]');
      await expect(saveBtn).toBeEnabled({ timeout: 3000 });
      await clickCardVisibilityButton(page, 'card-visibility-save-button');

      // Wait for save to complete — view exits edit mode and shows static indicators.
      await expect(matrix.locator('.vct-input-checkbox')).toHaveCount(0, {
        timeout: 5000,
      });
      expect(await matrix.locator('.vct-checkbox-indicator').count()).toBeGreaterThan(0);

      // --- Verify persistence by switching away and back ---
      // This forces a fresh server fetch for the target table without relying on
      // a full page reload or restored tree-localStorage state.
      await selectAnotherTable(page, selectedTableName);
      const reselectedTableName = await selectFirstTable(page, selectedTableName);
      expect(reselectedTableName).toBe(selectedTableName);
      await waitForMatrixColumns(page, expectedColumns);

      // --- Verify the toggled value persisted ---
      // Enter edit mode to read checkbox state
      await clickCardVisibilityButton(page, 'card-visibility-edit-button');
      await page.waitForTimeout(300);

      const persistedValue = await readFirstEditableCheckboxState(page, expectedColumns);
      expect(persistedValue).toBe(!originalChecked);

      // --- Restore original value (cleanup) ---
      await toggleFirstEditableCheckbox(page, expectedColumns);
      expect(await readFirstEditableCheckboxState(page, expectedColumns)).toBe(originalChecked);

      const saveBtn2 = page.locator('[data-testid="card-visibility-save-button"]');
      await expect(saveBtn2).toBeEnabled({ timeout: 3000 });
      await clickCardVisibilityButton(page, 'card-visibility-save-button');
      await page.waitForTimeout(1000);
    } finally {
      if (!page.isClosed()) {
        await dropTempDataset(page, datasetName);
      }
    }
  });
});
