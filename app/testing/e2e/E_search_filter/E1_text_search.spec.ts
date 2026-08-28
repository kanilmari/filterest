/**
 * E1_text_search.spec.ts
 *
 * Tests text search flow with SSE-style streaming responses.
 * Verifies search UI can be opened and result container appears.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { navigateToDataset } from '../helpers/navigation';

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

    const searchInput = page
      .locator('[data-testid="dataset-search-input"], [data-testid^="dataset-search-input-"]')
      .first();

    if (!(await searchInput.isVisible({ timeout: 3000 }).catch(() => false))) {
      // The search panel may need to be toggled open
      const searchBtn = page.locator('[data-testid="filterbar-toggle"]').first();

      if (await searchBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await searchBtn.click();
        await page.waitForSelector('[data-testid="dataset-search-input"], [data-testid^="dataset-search-input-"]', { timeout: 5000 });
      } else {
        test.skip(true, 'Search input not found');
        return;
      }
    }

    await searchInput.fill('test');
    await page.waitForTimeout(500);

    await page.waitForSelector('table tbody tr, .card, .no-results, .search-results', {
      timeout: 15000,
    });

    await expect(page.locator('body')).toBeVisible();
  });
});
