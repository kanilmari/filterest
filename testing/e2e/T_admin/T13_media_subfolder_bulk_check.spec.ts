/**
 * T13_media_subfolder_bulk_check.spec.ts
 *
 * Verifies the admin media tool can inspect every dataset without repairing files.
 * Bridges the live admin page, read-only check endpoint, and protected repair boundary.
 * Exists to prove the bulk check never calls the state-changing repair route.
 */

import { expect, test } from '@playwright/test';
import { loadCredentials, login, type TestCredentials } from '../helpers/auth';

test.describe('T13 — Media Subfolder Bulk Check', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test('checks all datasets without calling the repair endpoint', async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'desktop-card',
      'One desktop browser proves this read-only admin workflow.',
    );

    const checkRequests: string[] = [];
    const repairRequests: string[] = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.pathname === '/api/check-media-subfolders') {
        checkRequests.push(request.method());
      }
      if (url.pathname === '/api/fix-media-subfolders') {
        repairRequests.push(request.method());
      }
    });

    await login(page, credentials);
    await page.goto('/admin/fix_media_subfolders', { waitUntil: 'domcontentloaded' });

    const checkAllButton = page.getByTestId('check-all-media-subfolders');
    const fixAllButton = page.getByTestId('fix-all-media-subfolders');
    const status = page.locator('[role="status"]');
    await expect(checkAllButton).toBeVisible();
    await expect(fixAllButton).toBeVisible();

    await checkAllButton.click();
    await expect(status).toHaveAttribute('aria-busy', 'true');
    await expect(status).toHaveAttribute('aria-busy', 'false', { timeout: 60000 });
    await expect(status).toContainText('No files were changed.');

    expect(checkRequests.length).toBeGreaterThan(0);
    expect(new Set(checkRequests)).toEqual(new Set(['GET']));
    expect(repairRequests).toEqual([]);
  });
});
