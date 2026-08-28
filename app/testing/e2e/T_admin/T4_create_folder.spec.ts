/**
 * T4_create_folder.spec.ts
 *
 * Verifies that an admin can create a randomized folder through the navigation tree.
 * Registers and removes the exact folder id so the test cannot leave persistent data behind.
 */

import { test, expect, type Page } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { clickAdminTreeContextMenuItem, openNavTreeContextMenu } from '../helpers/admin-navigation';
import { navigateToDataset, waitForDataLoaded } from '../helpers/navigation';
import { fetchCsrfTokenForRequest } from '../helpers/temp-dataset';
import {
  confirmTestArtifact,
  registerTestArtifact,
  requireConfirmedTestArtifact,
  unregisterTestArtifact,
} from '../helpers/test-artifact-run-registry';
import { releasePlannedFolderIfAbsent } from '../helpers/test-artifact-folder-identity-reader';

type FolderMutationResult = {
  status: number;
  ok: boolean;
  body: string;
};

/** Builds a collision-resistant folder name that stays recognizable in cleanup evidence. */
function buildTestFolderName(): string {
  const suffix = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  return `e2e_folder_control_${suffix}`;
}

/** Deletes one exact registry-confirmed folder through the authenticated application API. */
async function deleteFolderById(
  page: Page,
  folderName: string,
  folderId: number,
): Promise<FolderMutationResult> {
  const csrfToken = await fetchCsrfTokenForRequest(page.request);
  requireConfirmedTestArtifact('folder', folderName, folderId);
  const response = await page.request.post('/api/delete-folder', {
    data: { folder_id: folderId },
    headers: { 'X-CSRF-Token': csrfToken },
  });
  return {
    status: response.status(),
    ok: response.ok(),
    body: await response.text(),
  };
}

test.describe('T4 — Create Folder', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('rejected folder creation releases planned ownership only after exact absence', async ({ page }) => {
    const folderName = `e2e_folder_rejected_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    registerTestArtifact('folder', folderName);

    const csrfToken = await fetchCsrfTokenForRequest(page.request);
    const createResponse = await page.request.post('/api/create-folder', {
      data: {
        folder_name: folderName,
        parent_id: 2_147_483_647,
      },
      headers: { 'X-CSRF-Token': csrfToken },
    });
    const createBody = await createResponse.text();
    expect(
      createResponse.status(),
      `Expected the missing-parent create to be rejected: ${createBody}`,
    ).toBe(400);

    await releasePlannedFolderIfAbsent(page.request, folderName);
  });

  test('admin can create folder in tree', async ({ page }) => {
    const folderName = buildTestFolderName();
    let folderId: number | null = null;
    let artifactRegistered = false;
    let primaryError: unknown = null;

    await navigateToDataset(page, 'app_service_catalog');
    await waitForDataLoaded(page, 'app_service_catalog');

    try {
      await openNavTreeContextMenu(page);

      const createFolderBtn = page.locator('[data-testid="admin-tree-menu-create_subfolder"]');
      await expect(
        createFolderBtn,
        'Folder context menu must advertise the create-subfolder action for an admin.',
      ).toBeVisible({ timeout: 5000 });
      await clickAdminTreeContextMenuItem(page, 'create_subfolder');

      const folderNameInput = page.locator('[data-testid="input-modal-input"]:visible').first();
      const confirmButton = page.locator('[data-testid="input-modal-confirm-button"]:visible').first();

      await expect(folderNameInput).toBeVisible({ timeout: 5000 });
      await expect(confirmButton).toHaveAttribute('data-lang-key', 'create_subfolder');

      await folderNameInput.fill(folderName);
      registerTestArtifact('folder', folderName);
      artifactRegistered = true;

      const [createResponse] = await Promise.all([
        page.waitForResponse((response) =>
          response.url().includes('/api/create-folder')
          && response.request().method() === 'POST',
        ),
        confirmButton.click(),
      ]);
      const createBody = await createResponse.text();
      if (!createResponse.ok()) {
        await releasePlannedFolderIfAbsent(page.request, folderName);
        artifactRegistered = false;
      }
      expect(
        createResponse.ok(),
        `Folder creation failed (${createResponse.status()}): ${createBody}`,
      ).toBe(true);

      const createPayload = JSON.parse(createBody) as { folder_id?: unknown };
      expect(
        Number.isSafeInteger(createPayload.folder_id) && Number(createPayload.folder_id) > 0,
        `Create-folder response must include a positive folder_id: ${createBody}`,
      ).toBe(true);
      folderId = Number(createPayload.folder_id);
      confirmTestArtifact('folder', folderName, folderId);

      const createdFolder = page.locator(
        `#nav_tree [data-testid=${JSON.stringify(`nav-tree-folder-f_${folderId}`)}]`,
      ).first();
      await expect(createdFolder).toBeAttached({ timeout: 10000 });
      await expect(
        createdFolder.locator(`[data-lang-key=${JSON.stringify(folderName)}]`),
        'Created folder tree node must retain the exact registered folder identity.',
      ).toHaveCount(1);
      await expect(createdFolder).not.toHaveText('');
    } catch (error) {
      primaryError = error;
    } finally {
      const cleanupErrors: string[] = [];
      if (folderId !== null) {
        const deleteResponse = await deleteFolderById(page, folderName, folderId).catch((error: Error) => {
          cleanupErrors.push(`delete-folder request failed: ${error.message}`);
          return null;
        });
        if (deleteResponse && !deleteResponse.ok && !deleteResponse.body.includes('not found')) {
          cleanupErrors.push(
            `delete-folder failed (${deleteResponse.status}): ${deleteResponse.body}`,
          );
        } else if (deleteResponse && artifactRegistered) {
          unregisterTestArtifact('folder', folderName);
          artifactRegistered = false;
        }
      }

      if (primaryError) {
        if (cleanupErrors.length > 0) {
          throw new AggregateError(
            [primaryError, new Error(cleanupErrors.join('\n'))],
            'Folder creation test failed and exact cleanup did not complete.',
          );
        }
        throw primaryError;
      }

      expect(cleanupErrors, cleanupErrors.join('\n')).toEqual([]);
    }
  });
});
