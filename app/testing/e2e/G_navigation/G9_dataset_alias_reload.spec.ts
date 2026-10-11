/**
 * G9_dataset_alias_reload.spec.ts
 * Proves immediate alias reload on one hydrated administrator page and its seeded row.
 * Bridges the readable catalogue, an obsolete persisted timestamp and cold bootstrap.
 * Keeps the regression at the reload itself instead of a helper's extra page navigation.
 */
import { test, expect, type TestInfo } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { navigateToDataset, waitForDataLoaded } from '../helpers/navigation';
import { switchToView } from '../helpers/view-switch';
import { buildTempDatasetName, createTempDataset, dropTempDataset } from '../helpers/temp-dataset';

function runsOnThisProject(project: TestInfo['project']): boolean {
  return project.metadata?.screenWidth === 'desktop' && project.metadata?.cardView === 'normal';
}

test.describe('G9 — A dataset alias address survives a reload', () => {
  let credentials: TestCredentials;
  const datasetName = buildTempDatasetName('app_e2e_alias_reload');
  const alias = datasetName.slice('app_'.length);
  const rowTitle = 'WL159 immediate alias reload row';
  let created = false;

  test.beforeAll(async ({ browser }, workerInfo) => {
    credentials = loadCredentials();
    if (!runsOnThisProject(workerInfo.project)) return;
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    try {
      await login(page, credentials);
      await createTempDataset(page, {
        datasetName, columns: { id: 'SERIAL', title: 'TEXT' }, seedRows: [{ title: rowTitle }],
      });
      created = true;
    } finally { await context.close(); }
  });

  test.afterAll(async ({ browser }) => {
    if (!created) return;
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    try {
      await login(page, credentials);
      await dropTempDataset(page, datasetName);
    } finally { await context.close(); }
  });

  test('reloads the same seeded row inside the obsolete timestamp window', async ({ page }, testInfo) => {
    test.skip(!runsOnThisProject(testInfo.project), 'One desktop project proves this page-load contract.');
    test.setTimeout(90_000);
    await login(page, credentials);
    // No helper page.goto: navigate on the catalogue-hydrated page login produced.
    await navigateToDataset(page, datasetName, { allowFallback: false });
    await switchToView(page, 'table');
    await waitForDataLoaded(page, datasetName);
    const rows = page.locator(`#${datasetName}_table_view_container`);
    await expect(rows.getByText(rowTitle, { exact: true })).toBeVisible();
    await expect.poll(() => new URL(page.url()).pathname).toBe(`/${alias}`);
    const obsoleteTimestamp = await page.evaluate(() => {
      const timestamp = Date.now();
      localStorage.setItem('easelect_dataset_alias_refresh_at', String(timestamp));
      return timestamp;
    });
    const started = Date.now();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(rows.getByText(rowTitle, { exact: true })).toBeVisible({ timeout: 20_000 });
    expect(Date.now() - started, 'The reload proof must finish within the old one-minute TTL').toBeLessThan(60_000);
    expect(await page.evaluate(timestamp => Date.now() - timestamp, obsoleteTimestamp)).toBeLessThan(60_000);
    expect(new URL(page.url()).pathname).toBe(`/${alias}`);
    expect(await page.evaluate(() => sessionStorage.getItem('selected_dataset'))).toBe(datasetName);
    await expect(page.locator('[data-testid="toast"]', { hasText: alias })).toHaveCount(0);
  });
});
