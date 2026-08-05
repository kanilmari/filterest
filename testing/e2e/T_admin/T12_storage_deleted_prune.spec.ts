/**
 * T12_storage_deleted_prune.spec.ts
 *
 * Verifies that the admin archived-storage prune endpoint removes only explicitly
 * requested top-level storage_deleted folders that no longer match a live dataset.
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';

type ArchivedFolderStatus = {
  folder?: string;
  prunable?: boolean;
};

type ArchivedFolderCheckResponse = {
  archived?: ArchivedFolderStatus[];
  prunable?: string[];
};

type PruneResponse = {
  pruned?: string[];
  count?: number;
};

async function fetchCsrfToken(page: Parameters<typeof login>[0]): Promise<string> {
  const csrfResponse = await page.evaluate(async () => {
    const response = await fetch('/api/csrf-token', {
      credentials: 'include',
    });
    return {
      ok: response.ok,
      body: await response.text(),
    };
  });

  expect(csrfResponse.ok, `Failed to fetch CSRF token: ${csrfResponse.body}`).toBe(true);
  const csrfData = JSON.parse(csrfResponse.body);
  const csrfToken = csrfData?.csrf_token;
  expect(typeof csrfToken === 'string' && csrfToken.trim() !== '', 'Expected csrf_token in /api/csrf-token response.').toBe(true);
  return csrfToken;
}

test.describe('T12 — Archived Storage Prune', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test('prune-archived-media-tables removes targeted archived dataset roots', async ({ page }) => {
    const folderName = `999${Date.now()}`;
    const archivedMarker = path.join('storage_deleted', folderName, '1', 'marker.txt');

    fs.rmSync(path.join('storage_deleted', folderName), { recursive: true, force: true });
    fs.mkdirSync(path.dirname(archivedMarker), { recursive: true });
    fs.writeFileSync(archivedMarker, 'marker');

    try {
      await login(page, credentials);

      const checkBefore = await page.evaluate(async () => {
        const response = await fetch('/api/check-archived-media-tables', {
          credentials: 'include',
        });
        return {
          status: response.status,
          body: await response.text(),
        };
      });
      expect(checkBefore.status, `check-archived-media-tables failed: ${checkBefore.body}`).toBe(200);
      const checkBeforeBody = JSON.parse(checkBefore.body) as ArchivedFolderCheckResponse;
      expect(Array.isArray(checkBeforeBody.archived), 'Expected archived array from check-archived-media-tables.').toBe(true);
      expect(checkBeforeBody.archived?.some((entry) => entry.folder === folderName && entry.prunable === true)).toBe(true);

      const csrfToken = await fetchCsrfToken(page);
      const pruneResult = await page.evaluate(
        async ({ csrfToken, folderName }) => {
          const response = await fetch('/api/prune-archived-media-tables', {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
              'X-CSRF-Token': csrfToken,
            },
            body: JSON.stringify({ folders: [folderName] }),
          });
          return {
            status: response.status,
            body: await response.text(),
          };
        },
        { csrfToken, folderName },
      );

      expect(pruneResult.status, `prune-archived-media-tables failed: ${pruneResult.body}`).toBe(200);
      const pruneBody = JSON.parse(pruneResult.body) as PruneResponse;
      expect(Array.isArray(pruneBody.pruned), 'Expected pruned array from prune-archived-media-tables.').toBe(true);
      expect(pruneBody.pruned).toContain(folderName);

      await expect.poll(() => fs.existsSync(path.join('storage_deleted', folderName))).toBe(false);

      const checkAfter = await page.evaluate(async () => {
        const response = await fetch('/api/check-archived-media-tables', {
          credentials: 'include',
        });
        return {
          status: response.status,
          body: await response.text(),
        };
      });
      expect(checkAfter.status, `check-archived-media-tables after prune failed: ${checkAfter.body}`).toBe(200);
      const checkAfterBody = JSON.parse(checkAfter.body) as ArchivedFolderCheckResponse;
      expect(checkAfterBody.archived?.some((entry) => entry.folder === folderName)).toBe(false);
    } finally {
      fs.rmSync(path.join('storage_deleted', folderName), { recursive: true, force: true });
    }
  });
});
