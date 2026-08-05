/**
 * I6_edit_fk_dropdown.spec.ts
 *
 * Tests inline editing behavior for foreign-key dropdown cells.
 */

import { test, expect, type APIRequestContext } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import {
  buildTempDatasetName,
  cleanupDatasetViaRequest,
  createTempDataset,
  openTempDataset,
} from '../helpers/temp-dataset';

/**
 * Removes every attempted fixture through the authenticated application API.
 * Bridges partial/post-create failures and request-scoped cleanup without requiring a live page.
 * Exists so hydration failures cannot strand FK-linked datasets in the shared dev database.
 */
async function cleanupAttemptedDatasets(
  request: APIRequestContext,
  datasetNames: string[],
): Promise<Error[]> {
  const cleanupErrors: Error[] = [];
  for (const datasetName of datasetNames) {
    try {
      await cleanupDatasetViaRequest(request, datasetName);
    } catch (error) {
      cleanupErrors.push(
        error instanceof Error
          ? error
          : new Error(`Unknown cleanup failure for "${datasetName}": ${String(error)}`),
      );
    }
  }
  return cleanupErrors;
}

test.describe('I6 — Edit FK Dropdown', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('inline edit FK dropdown cell', async ({ page, request }) => {
    test.setTimeout(60_000);
    const referencedDatasetName = buildTempDatasetName('e2e_i6_fk_reference');
    const datasetName = buildTempDatasetName('e2e_i6_fk_inline');
    let primaryError: unknown;

    try {
      await createTempDataset(page, {
        datasetName: referencedDatasetName,
        columns: {
          id: 'SERIAL',
          name: 'TEXT',
        },
        seedRows: [
          { name: 'Reference A' },
          { name: 'Reference B' },
        ],
      });

      await createTempDataset(page, {
        datasetName,
        columns: {
          id: 'SERIAL',
          category_id: 'INTEGER',
          title: 'TEXT',
        },
        foreignKeys: [
          {
            referencing_column: 'category_id',
            referenced_dataset: referencedDatasetName,
            referenced_column: 'id',
          },
        ],
        seedRows: [
          {
            category_id: 1,
            title: 'FK row',
          },
        ],
      });

      await openTempDataset(page, datasetName, 'table');

      const foreignKeyColumn = await page.evaluate((activeDatasetName) => {
        const rawDataTypes = localStorage.getItem(`${activeDatasetName}_dataTypes`);
        const rawColumns = localStorage.getItem(`${activeDatasetName}_columns`);
        if (!rawDataTypes || !rawColumns) {
          return null;
        }

        const dataTypes = JSON.parse(rawDataTypes) as Record<string, { foreign_table?: string }>;
        const columns = JSON.parse(rawColumns) as string[];
        return columns.find((column) => Boolean(dataTypes[column]?.foreign_table)) ?? null;
      }, datasetName);
      expect(foreignKeyColumn, 'Fixture FK metadata must identify category_id').toBe('category_id');

      const fkCell = page
        .locator(
          `#${datasetName}_table_view_container tbody tr:first-child ` +
          `[data-column=${JSON.stringify(foreignKeyColumn)}]:visible`,
        )
        .first();
      await expect(fkCell).toBeVisible({ timeout: 10000 });
      await fkCell.dblclick();

      const dropdown = fkCell.locator('[data-testid="inline-fk-dropdown"]');
      const searchInput = dropdown.locator('[data-testid="inline-fk-search-input"]');
      const options = dropdown.locator('[data-testid="inline-fk-option"]');
      await expect(dropdown).toBeVisible({ timeout: 5000 });
      await expect(searchInput).toBeVisible();
      await expect(options).toHaveCount(2);

      await searchInput.fill('Reference B');
      await expect(options).toHaveCount(1);
      const targetOption = options.first();
      await expect(targetOption).toHaveAttribute('data-display', 'Reference B');
      const targetForeignKeyValue = await targetOption.getAttribute('data-value');
      expect(targetForeignKeyValue, 'Reference B must expose its persisted foreign-key value')
        .toMatch(/^\d+$/);

      const updateResponsePromise = page.waitForResponse((response) => {
        const responseUrl = new URL(response.url());
        return (
          responseUrl.pathname === '/api/update-row'
          && responseUrl.searchParams.get('dataset') === datasetName
          && response.request().method() === 'POST'
        );
      }, { timeout: 15000 });
      await targetOption.click();
      const updateResponse = await updateResponsePromise;
      if (!updateResponse.ok()) {
        throw new Error(
          `FK inline update failed with HTTP ${updateResponse.status()}: `
          + await updateResponse.text(),
        );
      }

      await expect(dropdown).toBeHidden();
      await expect(fkCell).not.toHaveClass(/table_data_cell--inline-fk-editing/);
      await expect(fkCell).toHaveText(targetForeignKeyValue!);

      // openTempDataset performs a full app navigation before reopening the table,
      // so this assertion reads server state rather than the editor's in-memory row.
      await openTempDataset(page, datasetName, 'table');
      const persistedFkCell = page
        .locator(
          `#${datasetName}_table_view_container tbody tr:first-child `
          + `[data-column=${JSON.stringify(foreignKeyColumn)}]:visible`,
        )
        .first();
      await expect(persistedFkCell).toBeVisible({ timeout: 10000 });
      await expect(persistedFkCell).toHaveText(targetForeignKeyValue!);

      await persistedFkCell.dblclick();
      const reopenedDropdown = persistedFkCell.locator('[data-testid="inline-fk-dropdown"]');
      await expect(reopenedDropdown).toBeVisible({ timeout: 5000 });
      const persistedSelection = reopenedDropdown.locator(
        '[data-testid="inline-fk-option"].selected',
      );
      await expect(persistedSelection).toHaveCount(1);
      await expect(persistedSelection).toHaveAttribute('data-value', targetForeignKeyValue!);
      await expect(persistedSelection).toHaveAttribute('data-display', 'Reference B');
      await reopenedDropdown.locator('[data-testid="inline-fk-search-input"]').press('Escape');
      await expect(reopenedDropdown).toBeHidden();
    } catch (error) {
      primaryError = error;
    }

    const cleanupErrors = await cleanupAttemptedDatasets(request, [
      datasetName,
      referencedDatasetName,
    ]);
    if (primaryError !== undefined) {
      if (primaryError instanceof Error && cleanupErrors.length > 0) {
        try {
          Object.defineProperty(primaryError, 'cleanupErrors', {
            configurable: true,
            value: cleanupErrors,
          });
        } catch {
          // Preserve the original test failure even if its Error object is non-extensible.
        }
      }
      throw primaryError;
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(cleanupErrors, 'I6 fixture cleanup failed');
    }
  });
});
