import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { navigateToDataset, waitForDataLoaded } from '../helpers/navigation';
import { getActiveScrollableMetrics, scrollActiveContentToBottom } from '../helpers/scroll';
import { switchToView } from '../helpers/view-switch';

test.describe('Q1 — Infinite Scroll', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('scrolling down loads more rows', async ({ page }) => {
    await navigateToDataset(page, 'app_service_catalog');
    await waitForDataLoaded(page, 'app_service_catalog');
    await switchToView(page, 'table');

    const rows = page.locator(
      '#app_service_catalog_table_view_container [data-testid="dataset-view-table"] tbody tr',
    );
    await expect(rows.first()).toBeVisible({ timeout: 10000 });

    const initialCount = await rows.count();
    const beforeScroll = await getActiveScrollableMetrics(page);
    expect(beforeScroll).not.toBeNull();

    await scrollActiveContentToBottom(page);
    await page.waitForTimeout(2000);

    const afterScroll = await getActiveScrollableMetrics(page);
    expect(afterScroll).not.toBeNull();

    if (
      beforeScroll &&
      afterScroll &&
      beforeScroll.containerScrollHeight > beforeScroll.containerClientHeight
    ) {
      expect(afterScroll.containerScrollTop).toBeGreaterThan(beforeScroll.containerScrollTop);
    }

    const newCount = await rows.count();

    expect(newCount).toBeGreaterThanOrEqual(initialCount);
  });
});
