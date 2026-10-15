/**
 * V1_table_refresh.spec.ts
 * Verifies that the reset-search refresh control reloads table data from get-results endpoint.
 * Connects the shared active-filterbar helper with the reset button and results response.
 * Keeps refresh coverage active across responsive layouts without changing saved sections.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { navigateToDataset, waitForDataLoaded } from '../helpers/navigation';
import { revealActiveFilterbarSection } from '../helpers/filterbar';

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

    const filtersSection = await revealActiveFilterbarSection(page, 'filters');
    // On phones/tablets the open filter panel overlays the hero by design.
    // Use the reset inside the revealed section in every layout.
    const refreshControl = filtersSection.getByTestId('btn-reset-search-filter-stack');
    await expect(refreshControl).toBeVisible({ timeout: 5000 });

    const [response] = await Promise.all([
      page.waitForResponse(resp => resp.url().includes('/api/get-results'), { timeout: 10000 }).catch(() => null),
      refreshControl.click(),
    ]);

    expect(response).not.toBeNull();
    expect(response?.status()).toBe(200);
  });
});
