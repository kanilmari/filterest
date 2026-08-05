/**
 * T11_storage_root_cleanup.spec.ts
 *
 * Verifies that the admin storage-cleanup endpoints can archive unknown storage root folders.
 * Uses a synthetic top-level storage/<uid> folder so the test avoids live dataset/schema mutations.
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';

type ArchiveResponse = {
  archived?: string[];
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

test.describe('T11 — Storage Root Cleanup', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test('archive-media-tables archives unknown storage root folders', async ({ page }) => {
    const folderName = `999${Date.now()}`;
    const sourceMarker = path.join('storage', folderName, '1', 'marker.txt');
    const archivedMarker = path.join('storage_deleted', folderName, '1', 'marker.txt');

    fs.rmSync(path.join('storage', folderName), { recursive: true, force: true });
    fs.rmSync(path.join('storage_deleted', folderName), { recursive: true, force: true });
    fs.mkdirSync(path.dirname(sourceMarker), { recursive: true });
    fs.writeFileSync(sourceMarker, 'marker');

    try {
      await login(page, credentials);

      const checkBefore = await page.evaluate(async () => {
        const response = await fetch('/api/check-media-tables', {
          credentials: 'include',
        });
        return {
          status: response.status,
          body: await response.text(),
        };
      });
      expect(checkBefore.status, `check-media-tables failed: ${checkBefore.body}`).toBe(200);
      const checkBeforeBody = JSON.parse(checkBefore.body);
      expect(Array.isArray(checkBeforeBody.unknown), 'Expected unknown array from check-media-tables.').toBe(true);
      expect(checkBeforeBody.unknown).toContain(folderName);

      const csrfToken = await fetchCsrfToken(page);
      const archiveResult = await page.evaluate(
        async ({ csrfToken }) => {
          const response = await fetch('/api/archive-media-tables', {
            method: 'POST',
            credentials: 'include',
            headers: {
              'X-CSRF-Token': csrfToken,
            },
          });
          return {
            status: response.status,
            body: await response.text(),
          };
        },
        { csrfToken },
      );

      expect(archiveResult.status, `archive-media-tables failed: ${archiveResult.body}`).toBe(200);
      const archiveBody = JSON.parse(archiveResult.body) as ArchiveResponse;
      expect(Array.isArray(archiveBody.archived), 'Expected archived array from archive-media-tables.').toBe(true);
      expect(archiveBody.archived).toContain(folderName);

      await expect.poll(() => fs.existsSync(path.join('storage', folderName))).toBe(false);
      await expect.poll(() => fs.existsSync(archivedMarker)).toBe(true);

      const checkAfter = await page.evaluate(async () => {
        const response = await fetch('/api/check-media-tables', {
          credentials: 'include',
        });
        return {
          status: response.status,
          body: await response.text(),
        };
      });
      expect(checkAfter.status, `check-media-tables after archive failed: ${checkAfter.body}`).toBe(200);
      const checkAfterBody = JSON.parse(checkAfter.body);
      expect(checkAfterBody.unknown).not.toContain(folderName);
    } finally {
      fs.rmSync(path.join('storage', folderName), { recursive: true, force: true });
      fs.rmSync(path.join('storage_deleted', folderName), { recursive: true, force: true });
    }
  });
});
