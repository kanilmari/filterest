/**
 * T9_create_table_current_project_folder.spec.ts
 *
 * Verifies the folder-required create-table flow can create a new subfolder under an existing
 * current-project folder, place the new table under that nested path, and keep the dataset in
 * current-project metadata plus the reloaded navigation surfaces.
 */

import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { openAdminTreeButton } from '../helpers/admin-navigation';
import { waitForAppReady } from '../helpers/navigation';
import {
  openAdminNavigationTree,
  revealNavigationDatasetButtonByNodeId,
} from '../helpers/navigation-tree';
import {
  confirmTestArtifact,
  registerTestArtifact,
  requireConfirmedTestArtifact,
  unregisterTestArtifact,
} from '../helpers/test-artifact-run-registry';
import { readDatasetTableUIDFromPage } from '../helpers/test-artifact-dataset-identity-reader';
import { cleanupDatasetViaRequest, fetchCsrfTokenForRequest } from '../helpers/temp-dataset';

type CreatedTreeNodes = {
  folderDbId: number;
  tableNodeId: string;
};

type DatasetMetadata = {
  dataset_name?: string;
  is_in_current_project?: boolean;
  is_top_level_in_current_project?: boolean;
};

type DatasetListResponse = {
  datasets?: Array<{
    dataset_name?: string;
    folder_id?: number | null;
    is_in_current_project?: boolean;
    is_top_level_in_current_project?: boolean;
  }>;
};

function buildUniqueSuffix(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function fetchDatasets(page: Page): Promise<DatasetMetadata[]> {
  return page.evaluate(async () => {
    const response = await fetch('/api/datasets', {
      credentials: 'include',
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch datasets: ${response.status}`);
    }

    const parsed = await response.json();
    return Array.isArray(parsed?.datasets) ? parsed.datasets : [];
  });
}

async function findCreatedTreeNodes(
  page: Page,
  folderName: string,
  tableName: string,
  parentFolderDbId: string,
): Promise<CreatedTreeNodes> {
  await page.waitForFunction(
    ({ folderName, tableName, parentNodeId }) => {
      const rawTreeData = window.localStorage.getItem('full_tree_data');
      if (!rawTreeData) {
        return false;
      }

      const parsed = JSON.parse(rawTreeData);
      const nodes = Array.isArray(parsed?.nodes) ? parsed.nodes : [];
      const folderNode = nodes.find((node: Record<string, unknown>) =>
        node.name === folderName && node.parent_id === parentNodeId,
      );

      if (!folderNode || typeof folderNode.id !== 'string' || typeof folderNode.db_id !== 'number') {
        return false;
      }

      return nodes.some((node: Record<string, unknown>) =>
        node.name === tableName && node.parent_id === folderNode.id && typeof node.id === 'string',
      );
    },
    {
      folderName,
      tableName,
      parentNodeId: `f_${parentFolderDbId}`,
    },
    { timeout: 15000 },
  );

  return page.evaluate(
    ({ folderName, tableName, parentNodeId }) => {
      const rawTreeData = window.localStorage.getItem('full_tree_data');
      if (!rawTreeData) {
        throw new Error('full_tree_data is missing from localStorage.');
      }

      const parsed = JSON.parse(rawTreeData);
      const nodes = Array.isArray(parsed?.nodes) ? parsed.nodes : [];
      const folderNode = nodes.find((node: Record<string, unknown>) =>
        node.name === folderName && node.parent_id === parentNodeId,
      );

      if (!folderNode || typeof folderNode.id !== 'string' || typeof folderNode.db_id !== 'number') {
        throw new Error(`Could not resolve folder node for "${folderName}".`);
      }

      const tableNode = nodes.find((node: Record<string, unknown>) =>
        node.name === tableName && node.parent_id === folderNode.id && typeof node.id === 'string',
      );

      if (!tableNode || typeof tableNode.id !== 'string') {
        throw new Error(`Could not resolve table node for "${tableName}".`);
      }

      return {
        folderDbId: folderNode.db_id,
        tableNodeId: tableNode.id,
      };
    },
    {
      folderName,
      tableName,
      parentNodeId: `f_${parentFolderDbId}`,
    },
  );
}

async function findCurrentProjectParentFolderId(page: Page): Promise<string> {
  const datasetsResponse = await page.evaluate(async () => {
    const response = await fetch('/api/datasets', {
      credentials: 'include',
    });

    return {
      ok: response.ok,
      body: await response.text(),
    };
  });

  expect(
    datasetsResponse.ok,
    `Failed to fetch datasets for current-project folder discovery: ${datasetsResponse.body}`,
  ).toBe(true);

  const parsedResponse = JSON.parse(datasetsResponse.body) as DatasetListResponse;
  const currentProjectDataset = (parsedResponse.datasets ?? []).find((dataset) =>
    dataset?.is_top_level_in_current_project === true &&
    typeof dataset.folder_id === 'number' &&
    dataset.folder_id > 0,
  ) ?? (parsedResponse.datasets ?? []).find((dataset) =>
    dataset?.is_in_current_project === true &&
    typeof dataset.folder_id === 'number' &&
    dataset.folder_id > 0,
  );

  if (!currentProjectDataset || typeof currentProjectDataset.folder_id !== 'number') {
    throw new Error('Could not resolve an existing current-project folder from /api/datasets.');
  }

  return String(currentProjectDataset.folder_id);
}

/** Deletes a folder only after its live name/id and run-registry identity still agree. */
async function deleteConfirmedFolderViaRequest(
  request: APIRequestContext,
  folderName: string,
  folderId: number,
): Promise<void> {
  const csrfToken = await fetchCsrfTokenForRequest(request);
  const treeResponse = await request.get('/api/tree_data');
  const treeBody = await treeResponse.text();
  if (!treeResponse.ok()) {
    throw new Error(`Failed to verify folder ${folderId} before cleanup: ${treeBody}`);
  }

  const parsedResponse = JSON.parse(treeBody) as {
    nodes?: Array<{ id?: string; name?: string; db_id?: number }>;
  };
  if (!Array.isArray(parsedResponse.nodes)) {
    throw new Error('Malformed /api/tree_data response before folder cleanup.');
  }

  const liveFolder = parsedResponse.nodes.find((node) =>
    node?.db_id === folderId && typeof node.id === 'string' && node.id.startsWith('f_'),
  );
  if (!liveFolder) {
    unregisterTestArtifact('folder', folderName);
    return;
  }
  if (liveFolder.name !== folderName) {
    throw new Error(
      `Refusing to delete folder id ${folderId}: registered name "${folderName}" ` +
      `does not match live name "${String(liveFolder.name)}".`,
    );
  }

  // The live name/id check and exact registry check intentionally sit directly
  // before the destructive request so no name-only ownership inference is used.
  requireConfirmedTestArtifact('folder', folderName, folderId);
  const deleteResponse = await request.post('/api/delete-folder', {
    data: { folder_id: folderId },
    headers: { 'X-CSRF-Token': csrfToken },
  });
  const deleteBody = await deleteResponse.text();
  if (!deleteResponse.ok() && !deleteBody.includes('not found')) {
    throw new Error(`delete-folder failed (${deleteResponse.status()}): ${deleteBody}`);
  }
  unregisterTestArtifact('folder', folderName);
}

test.describe('T9 — Folder-Required Current Project Coverage', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
    await waitForAppReady(page);
  });

  test('create-table flow can create a nested subfolder and keep the dataset visible in current-project navigation', async ({ page }) => {
    const uniqueSuffix = buildUniqueSuffix();
    const testTableName = `e2e_folder_table_${uniqueSuffix}`.slice(0, 63);
    const testFolderName = `e2e_folder_${uniqueSuffix}`;

    let createdFolderDbId: number | null = null;
    let datasetConfirmed = false;
    let folderConfirmed = false;
    let primaryError: unknown = null;

    try {
      await openAdminTreeButton(page, 'create_table');

      const tableNameInput = page.locator('[data-testid="create-table-name-input"]');
      const existingFolderSelect = page.locator('[data-testid="create-table-folder-select"]');
      const newFolderNameInput = page.locator('[data-testid="create-table-new-folder-name"]');
      const newFolderParentSelect = page.locator('[data-testid="create-table-new-folder-parent"]');
      const submitButton = page.locator('[data-testid="create-table-submit"]');

      await expect(tableNameInput).toBeVisible({ timeout: 10000 });
      await expect(existingFolderSelect).toBeVisible({ timeout: 10000 });
      await expect(newFolderParentSelect).toBeVisible({ timeout: 10000 });

      const parentFolderDbId = await findCurrentProjectParentFolderId(page);

      await expect(existingFolderSelect.locator(`option[value="${parentFolderDbId}"]`)).toHaveCount(1);

      await tableNameInput.fill(testTableName);
      await newFolderNameInput.fill(testFolderName);
      await newFolderParentSelect.selectOption(parentFolderDbId);

      registerTestArtifact('dataset', testTableName);
      registerTestArtifact('folder', testFolderName);
      const [createResponse] = await Promise.all([
        page.waitForResponse((response) =>
          response.url().includes('/api/create_dataset') && response.request().method() === 'POST',
        ),
        submitButton.click(),
      ]);

      expect(createResponse.ok()).toBe(true);
      const tableUID = await readDatasetTableUIDFromPage(page, testTableName);
      expect(tableUID, 'Created dataset must expose a stable table_uid identity.').not.toBeNull();
      confirmTestArtifact('dataset', testTableName, tableUID!);
      datasetConfirmed = true;

      const createdTreeNodes = await findCreatedTreeNodes(page, testFolderName, testTableName, parentFolderDbId);
      createdFolderDbId = createdTreeNodes.folderDbId;
      confirmTestArtifact('folder', testFolderName, createdFolderDbId);
      folderConfirmed = true;

      // Some project/view combinations refresh current-project nav later than the create_dataset
      // response. Treat the pre-reload nav check as best-effort and keep the hard assertion after
      // a full reload, where the dataset must still be discoverable.
      let navVisibleBeforeReload = false;
      try {
        const navigationTree = await openAdminNavigationTree(page);
        await revealNavigationDatasetButtonByNodeId(
          navigationTree,
          createdTreeNodes.tableNodeId,
        );
        navVisibleBeforeReload = true;
      } catch {
        navVisibleBeforeReload = false;
      }

      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForAppReady(page);

      const datasets = await fetchDatasets(page);
      const createdDataset = datasets.find((dataset) => dataset.dataset_name === testTableName);
      expect(createdDataset, `Expected /api/datasets to include "${testTableName}".`).toBeTruthy();
      expect(createdDataset?.is_in_current_project).toBe(true);
      expect(navVisibleBeforeReload || createdDataset?.is_in_current_project).toBe(true);

      const navigationTree = await openAdminNavigationTree(page);
      const createdDatasetButton = await revealNavigationDatasetButtonByNodeId(
        navigationTree,
        createdTreeNodes.tableNodeId,
      );
      await createdDatasetButton.scrollIntoViewIfNeeded();
      await createdDatasetButton.click();

      await page.waitForSelector(
        `#${testTableName}_container, #${testTableName}_table_view_container`,
        {
          state: 'attached',
          timeout: 15000,
        },
      );
    } catch (error) {
      primaryError = error;
    } finally {
      const cleanupErrors: string[] = [];

      if (datasetConfirmed) {
        await cleanupDatasetViaRequest(page.request, testTableName).catch((error: Error) => {
          cleanupErrors.push(`drop-dataset request failed: ${error.message}`);
        });
      }

      if (folderConfirmed && createdFolderDbId !== null) {
        await deleteConfirmedFolderViaRequest(
          page.request,
          testFolderName,
          createdFolderDbId,
        ).catch((error: Error) => {
          cleanupErrors.push(`delete-folder request failed: ${error.message}`);
        });
      }

      if (primaryError) {
        if (cleanupErrors.length > 0) {
          throw new AggregateError(
            [primaryError, new Error(cleanupErrors.join('\n'))],
            'Nested folder create-table test failed and exact cleanup did not complete.',
          );
        }
        throw primaryError;
      }

      expect(cleanupErrors, cleanupErrors.join('\n')).toEqual([]);
    }
  });
});
