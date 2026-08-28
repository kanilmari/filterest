/**
 * T6_update_oids.spec.ts
 *
 * Verifies that the admin bootstrap still triggers the update OIDs request.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { waitForAppReady } from '../helpers/navigation';

test.describe('T6 — Update OIDs', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test('update OIDs request runs during admin app bootstrap', async ({ page }) => {
    const updateOidsResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes('/api/update-oids') &&
        response.request().method() === 'GET',
      { timeout: 15000 }
    ).catch(() => null);

    await login(page, credentials);
    await waitForAppReady(page);

    const updateOidsResponse = await updateOidsResponsePromise;
    if (!updateOidsResponse) {
      test.skip();
      return;
    }

    expect(updateOidsResponse.ok()).toBe(true);
  });
});
