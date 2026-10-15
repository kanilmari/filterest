// F1_sort_dropdown.spec.ts
// Verifies rendered sort order and the scoped, persistent sorting defaults.
// Connects native dropdown interactions with listing and settings API evidence.
// Keeps timestamp fixtures within the platform-managed create contract.
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

  for (const theme of ['light', 'dark'] as const) {
    test(`Newest shows its primary header and row order in ${theme} theme`, async ({ page }) => {
      // Opposite OS preference proves the application's explicit theme wins.
      await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light' });
      await page.evaluate((chosenTheme) => {
        document.body.classList.remove('light-mode', 'dark-mode');
        document.body.classList.add(`${chosenTheme}-mode`);
      }, theme);
      await navigateToDataset(page, 'app_service_catalog');
      await waitForDataLoaded(page, 'app_service_catalog');
      await switchToView(page, "table");

      const sortBtn = page.locator('[data-testid="sort-dropdown-trigger"]:visible').first();
      await expect(sortBtn).toBeVisible({ timeout: 5000 });
      await sortBtn.click();

      const sortOption = page
        .locator('[data-testid="sort-dropdown-option-newest-desc"]:visible')
        .first();
      await expect(sortOption).toBeVisible({ timeout: 3000 });
      const sortedResponsePromise = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return url.pathname === '/api/get-results'
          && url.searchParams.get('dataset') === 'app_service_catalog'
          && url.searchParams.get('sort_column') === '__newest'
          && url.searchParams.get('sort_order') === 'DESC'
          && Number(url.searchParams.get('offset') || 0) === 0;
      }, { timeout: 10000 });
      await sortOption.click();

      await expect(sortBtn).toHaveAttribute('data-lang-key', 'sort_newest', { timeout: 5000 });
      await expect(page).toHaveURL(/sort_column=__newest.*sort_order=DESC|sort_order=DESC.*sort_column=__newest/);
      const sortedResponse = await sortedResponsePromise;
      expect(sortedResponse.ok()).toBe(true);
      const { data, effective_sort: effectiveSort } = await sortedResponse.json() as {
        data: Array<{ id: number; created: string | null }>;
        effective_sort: { column: string; direction: string } | null;
      };
      expect(effectiveSort).toEqual({ column: 'created', direction: 'DESC' });
      const table = page.locator('#app_service_catalog_table');
      const primaryIndicator = table.getByTestId(`column-sort-${effectiveSort!.column}`);
      const primaryHeader = table.getByTestId(`column-header-${effectiveSort!.column}`);
      await expect(primaryIndicator).toHaveText('▼');
      const newestLabel = await sortBtn.inputValue();
      await expect(primaryIndicator).toHaveAttribute('title', `${newestLabel}: created`);
      await expect(primaryHeader).toHaveAttribute('aria-label', await primaryIndicator.getAttribute('title') || '');
      await expect(primaryIndicator).toHaveAttribute('data-title-lang-key', 'sort_newest');
      await expect(primaryHeader).toHaveAttribute('data-aria-label-lang-key', 'sort_newest');
      await expect(primaryHeader).toHaveAttribute('aria-sort', 'descending');
      await expect(table.locator('thead [aria-sort="descending"]')).toHaveCount(1);
      const otherIndicators = table.locator('[data-testid^="column-sort-"]');
      await expect.poll(() => otherIndicators.evaluateAll((elements) =>
        elements.filter(element => element.textContent === '▲' || element.textContent === '▼').length,
      )).toBe(1);
      await expect(table.getByTestId('column-sort-id')).toHaveText('⇵');
      await expect(page.locator('body')).toHaveClass(new RegExp(`${theme}-mode`));
      expect(data.length, 'The sort proof needs multiple service rows').toBeGreaterThan(1);
      for (const row of data) {
        if (row.created != null) expect(Number.isFinite(Date.parse(row.created))).toBe(true);
      }
      // The header describes the primary created order; id only breaks ties.
      // Check actual created DESC NULLS LAST, id DESC order and rendered rows.
      const expectedRows = [...data].sort((left, right) => {
        if (left.created == null && right.created != null) return 1;
        if (right.created == null && left.created != null) return -1;
        const timeDifference = left.created != null && right.created != null
          ? Date.parse(right.created) - Date.parse(left.created) : 0;
        return timeDifference || right.id - left.id;
      });
      expect(data.map((row) => row.id)).toEqual(expectedRows.map((row) => row.id));
      const rows = page.locator(
        '#app_service_catalog_table_view_container [data-testid="dataset-view-table"] tbody tr',
      );
      await expect(rows.first()).toBeVisible({ timeout: 10000 });
      await expect.poll(
        () => rows.evaluateAll((elements) => elements.map((row) => row.getAttribute('data-row-id'))),
        { timeout: 10000 },
      ).toEqual(expectedRows.map((row) => String(row.id)));
      await test.info().attach(`newest-header-${theme}`, {
        body: await page.screenshot(), contentType: 'image/png',
      });
    });
  }

  test('admin can open the scoped default action without changing the saved default', async ({ page }) => {
    await navigateToDataset(page, 'app_service_catalog');
    await waitForDataLoaded(page, 'app_service_catalog');
    const defaultUrl = '/api/dataset-sort-default?dataset=app_service_catalog';
    const beforeResponse = await page.request.get(defaultUrl);
    expect(beforeResponse.ok()).toBe(true);
    const savedDefault = await beforeResponse.json();

    const sortBtn = page.locator('[data-testid="sort-dropdown-trigger"]:visible').first();
    await expect(sortBtn).toBeVisible({ timeout: 5000 });
    await sortBtn.click();

    const newestOption = page
      .locator('[data-testid="sort-dropdown-option-newest-desc"]:visible')
      .first();
    await expect(newestOption).toBeVisible({ timeout: 3000 });
    await newestOption.hover();

    const menu = page.locator('.vdw-dropdown-list:visible').first();
    const menuBox = await menu.boundingBox();
    const viewport = page.viewportSize();
    expect(menuBox).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(menuBox!.width).toBeLessThanOrEqual(300);
    expect(menuBox!.x).toBeGreaterThanOrEqual(0);
    expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(viewport!.width);

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
    const afterResponse = await page.request.get(defaultUrl);
    expect(afterResponse.ok()).toBe(true);
    await expect(afterResponse.json()).resolves.toEqual(savedDefault);
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
      // The create API refuses created/updated in row payloads (18356d0c).
      seedRows: [{
        title: 'Sorting default proof',
      }],
    });

    try {
      await openTempDataset(page, datasetName, 'card');

      const sortBtn = page.locator('[data-testid="sort-dropdown-trigger"]:visible').first();
      await expect(sortBtn).toBeVisible({ timeout: 5000 });
      await sortBtn.click();

      const newestOption = page
        .locator('[data-testid="sort-dropdown-option-newest-desc"]:visible')
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
      await expect(page).toHaveURL(/sort_column=__newest.*sort_order=DESC|sort_order=DESC.*sort_column=__newest/);

      const readResponse = await page.request.get(
        `/api/dataset-sort-default?dataset=${encodeURIComponent(datasetName)}`,
      );
      expect(readResponse.ok()).toBe(true);
      await expect(readResponse.json()).resolves.toMatchObject({
        dataset: datasetName,
        value: '__newest:DESC',
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
