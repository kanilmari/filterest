// E22_guest_text_search.spec.ts
// Proves signed-out readers can narrow an owned public dataset without AI calls.
// Follows E12's empty guest context and reads browsing policy without changing it.
// Uses API-created temporary data and request-scoped cleanup even after failure.
import { expect, test } from '@playwright/test';
import { login, loadCredentials } from '../helpers/auth';
import { openActiveDatasetSearch } from '../helpers/dataset-search';
import {
  buildTempDatasetName, createTempDataset, cleanupDatasetViaRequest, openTempDataset,
} from '../helpers/temp-dataset';

test.describe('E22 — Guest text search without paid AI', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('shows the search box, narrows rows and never requests AI or embeddings', async ({ page, browser, playwright }, testInfo) => {
    test.setTimeout(120_000);
    const modesResponse = await page.request.get('/api/auth-modes');
    expect(modesResponse.ok()).toBe(true);
    const modes = await modesResponse.json();
    test.skip(Boolean(modes.login_required_for_browse),
      'Guest browsing is disabled on this instance; this proof never changes owner site settings.');

    const aiRequests: string[] = [];
    page.on('request', request => {
      const path = new URL(request.url()).pathname;
      if (/\/api\/.*(?:get-intelligent-results|get-results-vector|embed)/i.test(path)) aiRequests.push(path);
    });
    // The guest exists before the fixture: reload below must refresh its catalogue.
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const owner = await browser.newContext({
      baseURL: testInfo.project.use.baseURL, ignoreHTTPSErrors: true,
      extraHTTPHeaders: testInfo.project.use.extraHTTPHeaders,
      storageState: { cookies: [], origins: [] },
    });
    const ownerPage = await owner.newPage();
    const dataset = buildTempDatasetName('e2e_b283_guest_search');
    let created = false;
    let cleanupRequest: Awaited<ReturnType<typeof playwright.request.newContext>> | undefined;
    try {
      await login(ownerPage, loadCredentials());
      cleanupRequest = await playwright.request.newContext({
        baseURL: testInfo.project.use.baseURL, ignoreHTTPSErrors: true,
        extraHTTPHeaders: testInfo.project.use.extraHTTPHeaders,
        storageState: await owner.storageState(),
      });
      await createTempDataset(ownerPage, {
        datasetName: dataset, columns: { id: 'SERIAL', title: 'TEXT' },
        grantGuestsRead: true, grantUsersRead: false,
        seedRows: [{ title: 'Northlake lodge' }, { title: 'Southbay cottage' }],
      });
      created = true;
      await page.reload({ waitUntil: 'domcontentloaded' });
      // Visitors browse cards: guests hold the card view grant on every site, not the table view.
      await openTempDataset(page, dataset, 'card');
      const view = page.locator(`#${dataset}_card_view_container`);
      await expect(view.getByText('Northlake lodge').first()).toBeVisible();
      await expect(view.getByText('Southbay cottage').first()).toBeVisible();
      const input = await openActiveDatasetSearch(page);
      await expect(input).toBeVisible();
      const responsePromise = page.waitForResponse(response => {
        const url = new URL(response.url());
        return url.pathname === '/api/get-results'
          && url.searchParams.get('dataset') === dataset
          && url.searchParams.get('search') === 'northlake';
      });
      await input.fill('northlake');
      await input.press('Enter');
      const response = await responsePromise;
      expect(response.ok(), await response.text()).toBe(true);
      const results = await response.json();
      expect(results.row_count).toBe(1);
      await expect(view.getByText('Northlake lodge').first()).toBeVisible();
      await expect(view.getByText('Southbay cottage')).toHaveCount(0);
      await expect(page.locator('.search-ai-results-table, .search-ai-results-card-container')).toHaveCount(0);
      await expect(page.locator('[data-lang-key^="results_count_ai_search_"]')).toHaveCount(0);
      // Restoring the committed URL also exercises automatic searches.
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(view.getByText('Northlake lodge').first()).toBeVisible();
      await expect(view.getByText('Southbay cottage')).toHaveCount(0);
      expect(aiRequests, 'Guest browsing/search must never initiate paid AI or embedding work').toEqual([]);
    } finally {
      try {
        if (created && cleanupRequest) await cleanupDatasetViaRequest(cleanupRequest, dataset);
      } finally {
        await cleanupRequest?.dispose();
        await owner.close();
      }
    }
  });
});
