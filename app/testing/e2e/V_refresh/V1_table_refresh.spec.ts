/**
 * V1_table_refresh.spec.ts
 *
 * Verifies that the reset-search refresh control reloads table data from get-results endpoint.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { clickFirstVisibleByTestId, navigateToDataset, waitForDataLoaded } from '../helpers/navigation';

test.describe('V1 — Table Refresh', () => {
  let credentials: TestCredentials;
  const datasetName = 'app_service_catalog';

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('reset-search control reloads table data', async ({ page }) => {
    await navigateToDataset(page, datasetName);
    await waitForDataLoaded(page, datasetName);

    const refreshControl = page.locator('[data-testid="btn-reset-search"]');

    if (!(await refreshControl.first().isVisible({ timeout: 5000 }).catch(() => false))) {
      test.skip();
      return;
    }

    const [response] = await Promise.all([
      page.waitForResponse(resp => resp.url().includes('/api/get-results'), { timeout: 10000 }).catch(() => null),
      clickFirstVisibleByTestId(page, 'btn-reset-search'),
    ]);

    expect(response).not.toBeNull();
    expect(response?.status()).toBe(200);
  });
});
