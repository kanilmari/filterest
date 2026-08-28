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
import { openActiveFilterbarSection } from '../helpers/filterbar';

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

  test('creator gets permissions, images and label-free card fields by default', async ({ page }) => {
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
    const enableImagesCheckbox = page.locator('[data-testid="create-table-enable-images"]');
    const grantUsersReadCheckbox = page.locator('#grant_users_read');
    await expect(tableNameInput).toBeVisible({ timeout: 10000 });
    await expect(existingFolderSelect).toBeVisible({ timeout: 10000 });
    await expect(enableImagesCheckbox).toBeChecked();
    await expect(grantUsersReadCheckbox).not.toBeChecked();

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
    const [response, imageSetupResponse] = await Promise.all([
      page.waitForResponse(resp =>
        resp.url().includes('/api/create_dataset')
      ),
      page.waitForResponse(resp =>
        resp.url().includes('/api/asset-linking/images/enable')
          && resp.request().method() === 'POST'
      ),
      page.locator('[data-testid="create-table-submit"]').click(),
    ]);

    // Confirm API returned success
    expect(response.ok()).toBe(true);
    expect(imageSetupResponse.status()).toBe(201);
    const tableUID = await readDatasetTableUIDFromPage(page, testTableName);
    expect(tableUID, 'Created dataset must expose a stable table_uid identity.').not.toBeNull();
    confirmTestArtifact('dataset', testTableName, tableUID!);
    testTableConfirmed = true;

    const imageStatusResponse = await page.request.get(
      `/api/asset-linking/images/status?table=${encodeURIComponent(testTableName)}`,
    );
    expect(imageStatusResponse.ok()).toBe(true);
    const imageStatus = await imageStatusResponse.json();
    expect(imageStatus.asset_linkings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        parent_table: testTableName,
        enabled: true,
        relation_kind: 'shared_asset',
      }),
    ]));

    const newTableResponse = await page.request.get(
      `/api/get-results?dataset=${encodeURIComponent(testTableName)}`,
    );
    expect(newTableResponse.ok()).toBe(true);
    const newTablePayload = await newTableResponse.json();
    const fieldMetadata = Object.values(newTablePayload?.types ?? {}).filter(
      (metadata): metadata is Record<string, unknown> => (
        metadata !== null
        && typeof metadata === 'object'
        && Object.prototype.hasOwnProperty.call(metadata, 'show_key_on_card')
      ),
    );
    expect(fieldMetadata.length, 'A new table must expose its field presentation metadata.').toBeGreaterThan(0);
    expect(
      fieldMetadata.every((metadata) => metadata.show_key_on_card === false),
      'New table fields must hide their labels on cards by default.',
    ).toBe(true);
    await page.waitForTimeout(1000);

    // 4. Navigate to the new table via full page load. This must work for the
    // administrator even though ordinary Users read access remained disabled.
    //    (createDataset doesn't refresh sidebar tree, so page.goto is needed)
    await page.goto('/' + testTableName, { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);
    // Wait for the specific table's container to be attached
    await page.waitForSelector(`#${testTableName}_container, #${testTableName}_table_view_container`, {
      state: 'attached',
      timeout: 15000,
    });

    // The panel and its Add & manage content group both persist their own
    // collapsed state. Open the exact group before checking its permission-
    // gated actions so this proof follows the same path as an admin user.
    const toolsSection = await openActiveFilterbarSection(page, 'tools');
    await expect(toolsSection.locator('[data-testid="btn-add-row"]')).toBeVisible({ timeout: 10000 });

    // 6. Verify manage_table button is accessible
    const manageBtn = toolsSection.locator('[data-testid="btn-edit-table"]:visible').first();
    await expect(manageBtn).toBeVisible({ timeout: 5000 });
    await expect(manageBtn).toBeEnabled();
  });
});
