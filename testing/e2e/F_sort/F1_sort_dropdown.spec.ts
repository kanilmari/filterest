import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { navigateToDataset, waitForDataLoaded } from '../helpers/navigation';
import { switchToView } from '../helpers/view-switch';
import {
  buildTempDatasetName,
  createTempDataset,
  dropTempDataset,
  openTempDataset,
} from '../helpers/temp-dataset';

test.describe('FX — Sort Dropdown', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('sort dropdown changes data order', async ({ page }) => {
    await navigateToDataset(page, 'app_service_catalog');
    await waitForDataLoaded(page, 'app_service_catalog');
    await switchToView(page, "table");

    const sortBtn = page.locator('[data-testid="sort-dropdown-trigger"]:visible').first();
    await expect(sortBtn).toBeVisible({ timeout: 5000 });
    await sortBtn.click();

    const sortOption = page
      .locator('[data-testid="sort-dropdown-option-created-desc"]:visible')
      .first();
    await expect(sortOption).toBeVisible({ timeout: 3000 });
    await sortOption.click();

    await expect(sortBtn).toHaveAttribute('data-lang-key', 'sort_newest', { timeout: 5000 });
    await expect(
      page.locator(
        '#app_service_catalog_table_view_container [data-testid="column-sort-created"]',
      ),
    ).toHaveText('▼', { timeout: 10000 });
    await expect(
      page.locator(
        '#app_service_catalog_table_view_container [data-testid="dataset-view-table"] tbody tr',
    ).first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test('admin can open the scoped default action without changing the saved default', async ({ page }) => {
    await navigateToDataset(page, 'app_service_catalog');
    await waitForDataLoaded(page, 'app_service_catalog');

    const sortBtn = page.locator('[data-testid="sort-dropdown-trigger"]:visible').first();
    await expect(sortBtn).toBeVisible({ timeout: 5000 });
    await sortBtn.click();

    const newestOption = page
      .locator('[data-testid="sort-dropdown-option-created-desc"]:visible')
      .first();
    await expect(newestOption).toBeVisible({ timeout: 3000 });
    await newestOption.hover();

    const setDefaultButton = newestOption.locator('.sort-default-action');
    await expect(setDefaultButton).toBeVisible();
    await expect(setDefaultButton).toHaveText(/Set default|Aseta oletukseksi/);
    await setDefaultButton.click();

    const modal = page.locator('.modal_overlay:visible').last();
    await expect(modal).toBeVisible();
    await expect(modal.locator('[data-lang-key="sort_default_for_me"]')).toBeVisible();
    await expect(modal.locator('[data-lang-key="sort_default_for_everyone"]')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();
  });

  test('admin can persist a personal default for a temporary dataset', async ({ page }) => {
    test.skip(test.info().project.name !== 'desktop-card');
    const datasetName = buildTempDatasetName('e2e_sort_default');

    await createTempDataset(page, {
      datasetName,
      columns: {
        id: 'SERIAL',
        title: 'TEXT',
        created: 'TIMESTAMPTZ',
      },
      seedRows: [{
        title: 'Sorting default proof',
        created: new Date().toISOString(),
      }],
    });

    try {
      await openTempDataset(page, datasetName, 'card');

      const sortBtn = page.locator('[data-testid="sort-dropdown-trigger"]:visible').first();
      await expect(sortBtn).toBeVisible({ timeout: 5000 });
      await sortBtn.click();

      const newestOption = page
        .locator('[data-testid="sort-dropdown-option-created-desc"]:visible')
        .first();
      await newestOption.hover();
      await newestOption.locator('.sort-default-action').click();

      const saveResponsePromise = page.waitForResponse((response) => (
        response.url().includes('/api/admin/dataset-sort-default')
          && response.request().method() === 'POST'
      ));
      await page.locator('[data-lang-key="sort_default_for_me"]:visible').click();
      const saveResponse = await saveResponsePromise;
      expect(saveResponse.ok()).toBe(true);

      await expect(
        page.locator('[data-testid="toast"]:visible').filter({ hasText: /newest|uusin/i }),
      ).toBeVisible({ timeout: 5000 });
      await expect(sortBtn).toHaveAttribute('data-lang-key', 'sort_newest', { timeout: 5000 });
      await expect(page).toHaveURL(/sort_column=created.*sort_order=DESC|sort_order=DESC.*sort_column=created/);

      const readResponse = await page.request.get(
        `/api/dataset-sort-default?dataset=${encodeURIComponent(datasetName)}`,
      );
      expect(readResponse.ok()).toBe(true);
      await expect(readResponse.json()).resolves.toMatchObject({
        dataset: datasetName,
        value: 'created:DESC',
        scope: 'user',
        configured: true,
      });
    } finally {
      if (!page.isClosed()) {
        await dropTempDataset(page, datasetName);
      }
    }
  });
});
