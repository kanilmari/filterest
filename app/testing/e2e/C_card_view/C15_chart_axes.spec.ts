// C15_chart_axes.spec.ts
// Proves chart fit, shared addresses, axis redraw and administrator defaults.
// Connects card-project browsers to temporary datasets created through supported APIs.
// Verifies both application themes over opposite OS preferences and cleans up by stable identity.
import { expect, test } from '@playwright/test';
import { login, loadCredentials, loadUserCredentials } from '../helpers/auth';
import { buildTempDatasetName, createTempDataset, openTempDataset, cleanupDatasetViaRequest } from '../helpers/temp-dataset';
import { closeActiveFilterbarIfOpen, revealActiveFilterbarSection } from '../helpers/filterbar';
import { waitForAppReady, waitForDataLoaded } from '../helpers/navigation';

test('Chart is offered only when fitting; axes redraw, share, and save as dataset defaults', async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, loadCredentials());
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('user_permissions') || '[]')))
    .toContain('/ui/view/price_chart');
  const fitting = buildTempDatasetName('e2e_wl168_chart');
  const flat = buildTempDatasetName('e2e_wl168_no_time');
  const created: string[] = [];
  try {
    await createTempDataset(page, { datasetName: fitting,
      // Dataset creation requires decimal precision; chart metadata retains this numeric type.
      columns: { id: 'SERIAL', observed_at: 'DATE', close_price: 'NUMERIC(12,2)', volume: 'INTEGER' },
      seedRows: [
        { observed_at: '2026-01-01', close_price: 100, volume: 4 },
        { observed_at: '2026-01-02', close_price: 105, volume: 20 },
        { observed_at: '2026-01-03', close_price: 101, volume: 7 },
      ] });
    created.push(fitting);
    await createTempDataset(page, { datasetName: flat,
      columns: { id: 'SERIAL', name: 'TEXT' }, seedRows: [{ name: 'No clock' }] });
    created.push(flat);

    for (const theme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light' });
      await page.evaluate(() => localStorage.setItem('chosen_language', 'en'));
      await openTempDataset(page, fitting, 'card');
      const views = await revealActiveFilterbarSection(page, 'views');
      await page.evaluate(theme => {
        document.body.classList.remove('light-mode', 'dark-mode');
        document.body.classList.add(`${theme}-mode`);
      }, theme);
      await expect(page.locator('body')).toHaveClass(new RegExp(theme + '-mode'));
      await views.getByTestId('view-dropdown-more-trigger').click();
      const chartOption = page.locator('.vdw-option[data-lang-key="view_chart"]:visible');
      await expect(chartOption).toHaveText('Chart');
      await chartOption.click();
      await closeActiveFilterbarIfOpen(page);
      const chart = page.locator(`#${fitting}_price_chart_view_container`).getByTestId('price-chart-view');
      await expect(chart).toBeVisible();
      await expect(chart.getByTestId('chart-x-axis')).toHaveValue('observed_at');
      const y = chart.getByTestId('chart-y-axis');
      await y.selectOption('close_price');
      const initial = await chart.locator('path').getAttribute('d');
      await y.selectOption('volume');
      await expect(chart).toHaveAttribute('data-chart-y', 'volume');
      await expect(chart.locator('path')).not.toHaveAttribute('d', initial!);
      await expect(page).toHaveURL(/chart_y=volume/);
      await expect(page).toHaveURL(/chart_x=observed_at/);
      await page.goBack();
      await expect(y).toHaveValue('close_price');
      await page.goForward();
      await expect(y).toHaveValue('volume');
      const picker = await y.boundingBox();
      expect(picker).not.toBeNull();
      expect(picker!.x).toBeGreaterThanOrEqual(0);
      expect(picker!.x + picker!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
      await page.screenshot({ path: test.info().outputPath(`chart-${theme}.png`), fullPage: false });
    }

    // A fresh page must consume the shared address, including invalid-axis fallbacks.
    const shared = page.url();
    await page.goto(shared, { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);
    await expect(page.getByTestId('chart-y-axis')).toHaveValue('volume');
    await closeActiveFilterbarIfOpen(page);
    const saveResponse = page.waitForResponse(response => response.url().includes('/api/admin/view-field-sets/site/save')
      && response.request().method() === 'POST');
    await page.getByTestId('chart-save-default').click();
    expect((await saveResponse).ok()).toBe(true);
    const settings = await page.request.get(`/api/view-field-sets?dataset=${fitting}&view_key=price_chart`);
    expect(settings.ok()).toBe(true);
    const response = await settings.json();
    const saved = response.field_sets.find((set: { id: number }) => set.id === response.site_default_field_set_id);
    expect(saved.visible_columns).toEqual(['observed_at', 'volume']);
    const invalid = new URL(shared);
    invalid.searchParams.set('chart_x', 'missing');
    invalid.searchParams.set('chart_y', 'observed_at');
    await page.goto(invalid.href, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('chart-x-axis')).toHaveValue('observed_at');
    await expect(page.getByTestId('chart-y-axis')).toHaveValue('volume');

    await openTempDataset(page, flat, 'card');
    const views = await revealActiveFilterbarSection(page, 'views');
    await views.getByTestId('view-dropdown-more-trigger').click();
    await expect(page.locator('.vdw-option[data-lang-key="view_chart"]:visible')).toHaveCount(0);
    await closeActiveFilterbarIfOpen(page);
    const address = new URL(page.url());
    address.searchParams.set('view', 'price_chart');
    await page.goto(address.href, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('chart-unavailable')).toBeVisible();
    await expect(page.getByTestId('chart-unavailable')).toContainText('Chart requires');
    await expect(page.getByTestId('chart-unavailable').getByTestId('view-btn-table')).toBeVisible();
    await expect(page.getByTestId('price-chart-view')).toHaveCount(0);
    await expect(page).not.toHaveURL(/view=price_chart/);
  } finally {
    for (const dataset of created.reverse()) await cleanupDatasetViaRequest(page.request, dataset);
  }
});

test('Chart is staged: administrators can open it while an ungranted reader cannot', async ({ page, browser }) => {
  test.setTimeout(180_000);
  await login(page, loadCredentials());
  const dataset = buildTempDatasetName('e2e_wl168_chart_staging');
  const readerContext = await browser.newContext({ ignoreHTTPSErrors: true, storageState: { cookies: [], origins: [] } });
  let created = false;
  try {
    await createTempDataset(page, { datasetName: dataset, grantUsersRead: true,
      columns: { id: 'SERIAL', observed_at: 'DATE', volume: 'INTEGER' },
      seedRows: [{ observed_at: '2026-01-01', volume: 7 }] });
    created = true;
    await page.goto(`/${dataset}?view=price_chart`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('price-chart-view')).toBeVisible();

    const reader = await readerContext.newPage();
    await login(reader, loadUserCredentials());
    // This proof requires the reserved ordinary test account's groups to lack
    // Chart; never remove shared grants or manufacture permissions in the page.
    expect(await reader.evaluate(() => JSON.parse(sessionStorage.getItem('user_permissions') || '[]')))
      .not.toContain('/ui/view/price_chart');
    await reader.goto(`/${dataset}?view=price_chart&chart_x=observed_at&chart_y=volume`, { waitUntil: 'domcontentloaded' });
    await waitForAppReady(reader);
    await waitForDataLoaded(reader, dataset);
    await expect(reader.getByTestId('price-chart-view')).toHaveCount(0);
    const moreViews = reader.getByTestId('view-dropdown-more-trigger');
    if (await moreViews.isVisible()) await moreViews.click();
    await expect(reader.locator('.vdw-option[data-lang-key="view_chart"]:visible')).toHaveCount(0);
    await expect(reader.locator('[data-testid="view-btn-price_chart"]:visible')).toHaveCount(0);
    expect(await reader.evaluate(dataset => sessionStorage.getItem(`${dataset}_view`), dataset)).not.toBe('price_chart');
  } finally {
    await readerContext.close();
    if (created) await cleanupDatasetViaRequest(page.request, dataset);
  }
});
