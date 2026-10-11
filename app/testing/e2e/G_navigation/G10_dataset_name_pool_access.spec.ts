/**
 * G10_dataset_name_pool_access.spec.ts
 * Proves guests and ordinary readers bootstrap explicit names from their readable catalogue.
 * Bridges real read grants, denied legacy name transports and query/deep-link reloads.
 * Keeps private datasets out of name pools and tests without alias-list endpoint authority.
 */
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { login, loadCredentials, loadUserCredentials } from '../helpers/auth';
import { waitForAppReady, waitForDataLoaded } from '../helpers/navigation';
import {
  buildTempDatasetName, createTempDataset, dropTempDataset, fetchCsrfTokenForRequest,
} from '../helpers/temp-dataset';

const runsHere = (project: TestInfo['project']) =>
  project.metadata?.screenWidth === 'desktop' && project.metadata?.cardView === 'normal';
const readableName = buildTempDatasetName('app_e2e_pool_readable');
const privateName = buildTempDatasetName('app_e2e_pool_private');
const explicitAlias = `${readableName}-public`;
const privateAlias = `${privateName}-secret`;
const rowTitle = 'WL159 pool access row';
const created: string[] = [];

type CatalogueEntry = {
  table_uid: number; dataset_name: string; names: string[]; preferred_name: string; can_read_rows: boolean;
};

async function saveAlias(page: Page, datasetName: string, alias: string): Promise<void> {
  const token = await fetchCsrfTokenForRequest(page.request);
  const response = await page.request.post('/api/dataset-alias-management/save', {
    data: { dataset_name: datasetName, alias_slug: alias }, headers: { 'X-CSRF-Token': token },
  });
  expect(response.ok(), await response.text()).toBe(true);
}

/** Denies both legacy transports without altering shared installation permissions. */
async function denyLegacyNameEndpoints(page: Page): Promise<string[]> {
  const requests: string[] = [];
  for (const path of ['/api/dataset-aliases', '/api/dataset-names']) {
    await page.route(`**${path}*`, async route => {
      requests.push(new URL(route.request().url()).pathname);
      await route.fulfill({ status: 403, contentType: 'application/json', body: '{"error":"forbidden"}' });
    });
  }
  return requests;
}

async function proveReadablePool(page: Page, legacyRequests: string[]): Promise<void> {
  const response = await page.request.get('/api/datasets');
  expect(response.ok()).toBe(true);
  expect(response.headers()['cache-control']).toBe('private, no-store');
  const body = await response.json() as { datasets: CatalogueEntry[] };
  const entry = body.datasets.find(dataset => dataset.dataset_name === readableName);
  expect(entry).toMatchObject({ preferred_name: explicitAlias, can_read_rows: true });
  expect(entry?.table_uid).toBeGreaterThan(0);
  expect(entry?.names).toEqual(expect.arrayContaining([readableName, explicitAlias]));
  expect(JSON.stringify(body)).not.toContain(privateName);
  expect(JSON.stringify(body)).not.toContain(privateAlias);
  await page.goto(`/${explicitAlias}?search=${encodeURIComponent(rowTitle)}&view=card`, { waitUntil: 'domcontentloaded' });
  await waitForDataLoaded(page, readableName);
  const surface = page.locator(`#${readableName}_container:visible`);
  await expect(surface.getByText(rowTitle, { exact: true })).toBeVisible({ timeout: 20_000 });
  expect(await page.evaluate(dataset => {
    const params = JSON.parse(localStorage.getItem('dataset_query_params') || '{}');
    return { canonical: params[dataset], alias: params[`${dataset}-public`] };
  }, readableName)).toEqual({ canonical: { search: rowTitle }, alias: undefined });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(surface.getByText(rowTitle, { exact: true })).toBeVisible({ timeout: 20_000 });
  expect(new URL(page.url()).pathname).toBe(`/${explicitAlias}`);
  expect(legacyRequests).toEqual([]);
}

test.describe('G10 — Readable name pools without legacy alias reads', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeAll(async ({ browser }, workerInfo) => {
    if (!runsHere(workerInfo.project)) return;
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    try {
      await login(page, loadCredentials());
      await createTempDataset(page, { datasetName: readableName, columns: { id: 'SERIAL', title: 'TEXT' },
        seedRows: [{ title: rowTitle }], grantUsersRead: true, grantGuestsRead: true });
      created.push(readableName);
      await saveAlias(page, readableName, explicitAlias);
      await createTempDataset(page, { datasetName: privateName, columns: { id: 'SERIAL', title: 'TEXT' } });
      created.push(privateName);
      await saveAlias(page, privateName, privateAlias);
    } finally { await context.close(); }
  });

  test.afterAll(async ({ browser }) => {
    if (!created.length) return;
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    try {
      await login(page, loadCredentials());
      for (const name of [...created].reverse()) await dropTempDataset(page, name);
    } finally { await context.close(); }
  });

  test('guest loads and reloads an explicit readable alias', async ({ page }, testInfo) => {
    test.skip(!runsHere(testInfo.project), 'One desktop project proves this catalogue boundary.');
    test.setTimeout(90_000);
    const legacyRequests = await denyLegacyNameEndpoints(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);
    await proveReadablePool(page, legacyRequests);
  });

  test('ordinary reader loads and reloads an explicit readable alias', async ({ page }, testInfo) => {
    test.skip(!runsHere(testInfo.project), 'One desktop project proves this catalogue boundary.');
    test.setTimeout(90_000);
    const legacyRequests = await denyLegacyNameEndpoints(page);
    await login(page, loadUserCredentials());
    await proveReadablePool(page, legacyRequests);
  });
});
