/**
 * C3_close_big_card.spec.ts
 *
 * Verifies article dismissal through the article record bar at every width.
 * Connects card-to-article navigation with the canonical dataset list address.
 * Keeps hidden legacy chrome and internal dataset names out of the browser proof.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { navigateToDataset } from '../helpers/navigation';
import { switchToView, openBigCard } from '../helpers/view-switch';

test.describe('C3 — Close Big Card', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('big card can be closed', async ({ page }) => {
    await navigateToDataset(page, 'app_service_catalog');
    await switchToView(page, 'card');
    await page.waitForSelector('[data-testid="card-item"]', { timeout: 10000 });
    const listUrl = page.url();
    const opened = await openBigCard(page);
    expect(opened, 'The article must open before its controls can be checked').toBe(true);
    const bigCard = page.locator('[data-testid="big-card-container"]');
    await expect(bigCard).toBeVisible({ timeout: 5000 });
    const bar = bigCard.getByTestId('row-article-record-bar');
    await expect(bar).toBeVisible();
    await expect(bar.getByTestId('row-article-previous-row')).toBeVisible();
    await expect(bar.getByTestId('row-article-next-row')).toBeVisible();
    await expect(page.getByTestId('shared-topbar-article-close')).toBeHidden();
    await expect(page.getByTestId('big-card-close')).toBeHidden();
    expect(page.url()).not.toBe(listUrl);
    await bar.getByTestId('row-article-record-bar-close').click();
    await expect(page.getByTestId('card-item').first()).toBeVisible();
    // dataset_aliases.js maps the internal app_ name to this public address.
    await expect(page).toHaveURL(/\/service_catalog(?:\?.*)?$/, { timeout: 5000 });
    await expect.poll(() => new URL(page.url()).searchParams.get('view'))
      .not.toBe('article_view');
    await expect(page.locator('[data-testid="big-card-container"]:visible')).toHaveCount(0, { timeout: 5000 });
    await expect(page.locator('.card_view_wrapper.big-card-open')).toHaveCount(0, { timeout: 5000 });
  });
});
