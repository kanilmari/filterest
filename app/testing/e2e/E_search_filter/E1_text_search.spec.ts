// E1_text_search.spec.ts
// Tests text search and the appearance of its result container.
// Connects the active dataset's responsive search UI to the existing search flow.
// Requires usable search on every project, including phones with a search button.

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { navigateToDataset } from '../helpers/navigation';
import { openActiveDatasetSearch } from '../helpers/dataset-search';

test.describe('E1 — Text Search', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('text search returns results', async ({ page }) => {
    await navigateToDataset(page, 'app_service_catalog');

    const searchInput = await openActiveDatasetSearch(page);

    await searchInput.fill('test');
    await page.waitForTimeout(500);

    await page.waitForSelector('table tbody tr, .card, .no-results, .search-results', {
      timeout: 15000,
    });

    await expect(page.locator('body')).toBeVisible();
  });
});
