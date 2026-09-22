/**
 * T2_delete_table.spec.ts
 *
 * Verifies that deleting a dataset redirects to home and shows notification.
 * Uses sidebar evaluate() pattern for fixed-position admin tree navigation.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { openAdminTreeButton } from '../helpers/admin-navigation';
import { waitForAppReady } from '../helpers/navigation';
import { cleanupDatasetViaRequest } from '../helpers/temp-dataset';
import {
  confirmTestArtifact,
  registerTestArtifact,
  unregisterTestArtifact,
} from '../helpers/test-artifact-run-registry';
import { readDatasetTableUIDFromPage } from '../helpers/test-artifact-dataset-identity-reader';
import { openActiveFilterbarSection } from '../helpers/filterbar';

test.describe('Dataset Deletion Handling', () => {
  // Force a desktop-sized viewport so the admin delete flow stays consistent across projects.
  test.use({ viewport: { width: 1920, height: 1080 } });
  let testTableName = '';
  let testTableConfirmed = false;
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  // Cleanup: delete the test table via API if it still exists (e.g. test failed before UI deletion)
  test.afterEach(async ({ request }) => {
    if (testTableConfirmed) {
      await cleanupDatasetViaRequest(request, testTableName);
    }
    testTableName = '';
    testTableConfirmed = false;
  });

  test.beforeEach(async ({ page }) => {
    const projectName = test.info().project.name.replace(/[^a-z0-9]+/gi, '_').toLowerCase();
    testTableName = `test_deletion_table_${projectName}_${Date.now()}`;
    testTableConfirmed = false;
    await login(page, credentials);
    await waitForAppReady(page);
  });

  test('Deleting a dataset redirects to home and shows notification', async ({ page }) => {
    // Accept any dialogs that may appear
    page.on('dialog', async dialog => {
      await dialog.accept();
    });

    // 1. Open the create-table admin view via stable testid anchors.
    await openAdminTreeButton(page, 'create_table');
    await page.waitForTimeout(500);

    // 2. Fill table name
    const tableNameInput = page.locator('[data-testid="dataset-name-input"]');
    const existingFolderSelect = page.locator('[data-testid="dataset-folder-select"]');
    const newFolderNameInput = page.locator('[data-testid="dataset-new-folder-name"]');
    const newFolderParentSelect = page.locator('[data-testid="dataset-new-folder-parent"]');
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
    // The new-folder fields stay hidden until "New folder…" is chosen, so the
    // dataset goes to the folder selected above.
    await expect(newFolderNameInput).toBeHidden();
    await expect(newFolderParentSelect).toBeHidden();

    // 3. Submit and wait for API response.
    registerTestArtifact('dataset', testTableName);
    const [createResponse] = await Promise.all([
      page.waitForResponse(resp =>
        resp.url().includes('/api/create_dataset')
      ),
      page.locator('[data-testid="dataset-form-submit"]').click(),
    ]);
    expect(createResponse.ok()).toBe(true);
    const tableUID = await readDatasetTableUIDFromPage(page, testTableName);
    expect(tableUID, 'Created dataset must expose a stable table_uid identity.').not.toBeNull();
    confirmTestArtifact('dataset', testTableName, tableUID!);
    testTableConfirmed = true;
    await page.waitForTimeout(1000);

    // 4. Navigate to the new table via full page load
    await page.goto('/' + testTableName, { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);
    await page.waitForSelector(`#${testTableName}_container, #${testTableName}_table_view_container`, {
      state: 'attached',
      timeout: 15000,
    });

    // Safety check — should not be on app_service_catalog
    const currentUrl = page.url();
    if (currentUrl.includes('app_service_catalog')) {
      throw new Error('SAFETY ABORT: Attempting to delete app_service_catalog!');
    }

    // 5. Delete the table through the stable toolbar/modal anchors. The panel
    // and its Add & manage content group both keep their own collapsed state,
    // so open that exact group first, as T1 does.
    const toolsSection = await openActiveFilterbarSection(page, 'tools');
    const manageBtn = toolsSection.locator('[data-testid="btn-edit-table"]:visible').first();
    await expect(manageBtn).toBeVisible({ timeout: 10000 });
    await expect(manageBtn).toBeEnabled();
    await manageBtn.click();
    await expect(page.locator('[data-testid="modal-container"]')).toBeVisible({ timeout: 10000 });

    // 6. Click delete button
    const deleteBtn = page.locator('[data-testid="btn-delete-table"]');
    await expect(deleteBtn).toBeVisible({ timeout: 5000 });
    await deleteBtn.click();

    const confirmModal = page.locator('[data-testid="dataset-removal-dialog"]');
    await expect(confirmModal).toBeVisible({ timeout: 5000 });
    await expect(confirmModal.getByTestId('dataset-removal-mode-hide')).toBeChecked();
    await confirmModal.getByTestId('dataset-removal-mode-permanent').check();
    const confirmBtn = confirmModal.getByTestId('dataset-removal-confirm');
    await expect(confirmBtn).toBeDisabled();
    await expect(confirmModal.getByTestId('dataset-removal-irreversible-warning')).toBeVisible();
    await confirmModal.getByTestId('dataset-removal-confirm-name').fill(testTableName);
    await expect(confirmBtn).toBeEnabled();

    await page.evaluate(() => {
      (window as Window & { __spa_delete_marker?: boolean }).__spa_delete_marker = true;
    });

    const [dropResponse] = await Promise.all([
      page.waitForResponse(resp =>
        resp.url().includes('/api/drop-dataset') && resp.request().method() === 'POST'
      ),
      confirmBtn.click(),
    ]);
    expect(dropResponse.ok()).toBe(true);
    unregisterTestArtifact('dataset', testTableName);
    testTableConfirmed = false;

    await page.waitForURL(url => url.pathname === '/', { timeout: 10000 });
    await waitForAppReady(page);

    const markerSurvived = await page.evaluate(() =>
      (window as Window & { __spa_delete_marker?: boolean }).__spa_delete_marker === true,
    );
    expect(markerSurvived).toBe(true);

    // 7. Verify the notice. It appears once the rebuilt shell has finished
    // loading, which can be after the tabs are drawn, so wait for it rather
    // than read it once (isVisible does not wait, whatever its timeout says).
    await expect(page.locator('[data-testid="toast"]').first()).toBeVisible({ timeout: 5000 });
  });
});
