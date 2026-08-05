/**
 * T1_create_table.spec.ts
 *
 * Verifies that creating a table automatically grants permissions to the creator.
 * Uses sidebar evaluate() pattern for fixed-position admin tree navigation.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { openAdminTreeButton } from '../helpers/admin-navigation';
import { waitForAppReady } from '../helpers/navigation';
import { cleanupDatasetViaRequest } from '../helpers/temp-dataset';
import { confirmTestArtifact, registerTestArtifact } from '../helpers/test-artifact-run-registry';
import { readDatasetTableUIDFromPage } from '../helpers/test-artifact-dataset-identity-reader';
import { openActiveFilterbarIfCollapsed } from '../helpers/filterbar';

test.describe('Table Creation Permissions', () => {
  // Forces 1920×1080 so the admin create-table flow renders consistently across projects.
  test.use({ viewport: { width: 1920, height: 1080 } });
  let credentials: TestCredentials;
  let testTableName = '';
  let testTableConfirmed = false;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.afterEach(async ({ request }) => {
    if (testTableConfirmed) {
      await cleanupDatasetViaRequest(request, testTableName);
    }
    testTableName = '';
    testTableConfirmed = false;
  });

  test.beforeEach(async ({ page }) => {
    const projectName = test.info().project.name.replace(/[^a-z0-9]+/gi, '_').toLowerCase();
    testTableName = `test_perm_table_${projectName}_${Date.now()}`;
    testTableConfirmed = false;
    page.on('console', msg => console.log(`BROWSER LOG: ${msg.text()}`));
    await login(page, credentials);
    await waitForAppReady(page);
  });

  test('Creator gets permissions automatically', async ({ page }) => {
    // Accept any dialogs that may appear during table creation
    page.on('dialog', async dialog => {
      await dialog.accept();
    });

    // 1. Open the create-table admin view via stable testid anchors.
    await openAdminTreeButton(page, 'create_table');
    await page.waitForTimeout(500);

    // 2. Fill table name
    const tableNameInput = page.locator('[data-testid="create-table-name-input"]');
    const existingFolderSelect = page.locator('[data-testid="create-table-folder-select"]');
    const newFolderNameInput = page.locator('[data-testid="create-table-new-folder-name"]');
    const newFolderParentSelect = page.locator('[data-testid="create-table-new-folder-parent"]');
    await expect(tableNameInput).toBeVisible({ timeout: 10000 });
    await expect(existingFolderSelect).toBeVisible({ timeout: 10000 });

    const selectedFolderId = await existingFolderSelect.evaluate((select) => {
      if (!(select instanceof HTMLSelectElement)) {
        return '';
      }

      const firstRealOption = Array.from(select.options).find((option) => option.value.trim() !== '');
      select.value = firstRealOption?.value ?? '';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return select.value;
    });

    expect(selectedFolderId, 'Create-table form must offer at least one valid folder option.').not.toBe('');
    await tableNameInput.fill(testTableName);
    await newFolderNameInput.fill('');
    await newFolderParentSelect.selectOption(selectedFolderId).catch(() => {});

    // 3. Submit and wait for the create-dataset API response.
    registerTestArtifact('dataset', testTableName);
    const [response] = await Promise.all([
      page.waitForResponse(resp =>
        resp.url().includes('/api/create_dataset')
      ),
      page.locator('[data-testid="create-table-submit"]').click(),
    ]);

    // Confirm API returned success
    expect(response.ok()).toBe(true);
    const tableUID = await readDatasetTableUIDFromPage(page, testTableName);
    expect(tableUID, 'Created dataset must expose a stable table_uid identity.').not.toBeNull();
    confirmTestArtifact('dataset', testTableName, tableUID!);
    testTableConfirmed = true;
    await page.waitForTimeout(1000);

    // 4. Navigate to the new table via full page load
    //    (createDataset doesn't refresh sidebar tree, so page.goto is needed)
    await page.goto('/' + testTableName, { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);
    // Wait for the specific table's container to be attached
    await page.waitForSelector(`#${testTableName}_container, #${testTableName}_table_view_container`, {
      state: 'attached',
      timeout: 15000,
    });

    await expect(page.locator('[data-testid="btn-add-row"]')).toBeVisible({ timeout: 10000 });

    // 6. Verify manage_table button is accessible
    await openActiveFilterbarIfCollapsed(page);
    const activeTableParts = page.locator('.tab_parts_container:visible').first();
    const manageBtn = activeTableParts.locator('[data-testid="btn-edit-table"]:visible').first();
    await expect(manageBtn).toBeVisible({ timeout: 5000 });
    await expect(manageBtn).toBeEnabled();
  });
});
