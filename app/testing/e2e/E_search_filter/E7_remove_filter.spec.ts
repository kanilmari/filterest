/**
 * E7_remove_filter.spec.ts
 *
 * Verifies removing a column filter restores all rows in a temporary dataset.
 * Connects the filter tag's remove control with an API-seeded dataset lifecycle.
 * Keeps the remove-filter proof independent of shared database content.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import {
  closeActiveFilterbarIfOpen,
  openColumnFilterAccordion,
} from '../helpers/filterbar';
import {
  buildTempDatasetName,
  cleanupDatasetViaRequest,
  createTempDataset,
  openTempDataset,
} from '../helpers/temp-dataset';

test.describe('E7 — Remove Filter', () => {
  let credentials: TestCredentials;
  let datasetToCleanup: string | undefined;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    datasetToCleanup = undefined;
    await login(page, credentials);
  });

  test.afterEach(async ({ request }) => {
    // Request cleanup also runs after assertion failures, timeouts or a closed page.
    if (datasetToCleanup) {
      await cleanupDatasetViaRequest(request, datasetToCleanup);
      datasetToCleanup = undefined;
    }
  });

  test('clicking filter tag X removes the filter', async ({ page }) => {
    test.setTimeout(60_000);
    const datasetName = buildTempDatasetName('e2e_e7_remove_filter');
    const filterValue = 'Identity and access service';
    const seedRows = [
      { header: filterValue },
      { header: 'Unrelated service' },
    ];

    // The helper compensates creation/seeding failures; the hook owns later cleanup.
    await createTempDataset(page, {
      datasetName,
      columns: { id: 'SERIAL', header: 'TEXT' },
      seedRows,
    });
    datasetToCleanup = datasetName;
    await openTempDataset(page, datasetName, 'table');

    const rows = page.locator(
      `#${datasetName}_table_view_container [data-testid="dataset-view-table"] tbody tr`,
    );
    await expect(rows).toHaveCount(seedRows.length, { timeout: 10000 });
    const initialCount = await rows.count();
    expect(initialCount).toBeGreaterThan(1);

    const headerFilterRow = await openColumnFilterAccordion(
      page,
      datasetName,
      'header',
    );
    const filterInput = headerFilterRow.locator(`#${datasetName}_header`);
    await expect(filterInput).toBeVisible({ timeout: 5000 });
    await expect(filterInput).toHaveValue('');

    await filterInput.fill(filterValue);
    await filterInput.press('Enter');

    await expect(rows).toHaveCount(1, { timeout: 10000 });
    await expect(rows).toContainText(filterValue);
    const exactActiveFilter = page
      .locator('[data-testid="active-filter-item"]:visible')
      .filter({ hasText: filterValue });
    await expect(exactActiveFilter).toHaveCount(1, { timeout: 5000 });

    await closeActiveFilterbarIfOpen(page);
    const removeBtn = exactActiveFilter.locator('[data-testid="active-filter-remove"]');
    await expect(removeBtn).toBeVisible({ timeout: 5000 });
    await removeBtn.click();

    await expect(exactActiveFilter).toHaveCount(0, { timeout: 5000 });
    await expect(rows).toHaveCount(initialCount, { timeout: 10000 });
  });
});
