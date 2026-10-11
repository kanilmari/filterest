/**
 * C3_close_big_card.spec.ts
 *
 * Verifies article dismissal through browser Back on phones and the wide close control.
 * Connects card-to-article navigation with the canonical dataset list address.
 * Keeps hidden legacy chrome and internal dataset names out of the browser proof.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { navigateToDataset } from '../helpers/navigation';
import { switchToView, openBigCard, closeBigCard } from '../helpers/view-switch';

test.describe('C3 — Close Big Card', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('big card can be closed', async ({ page }, info) => {
    await navigateToDataset(page, 'app_service_catalog');
    await switchToView(page, 'card');
    await page.waitForSelector('[data-testid="card-item"]', { timeout: 10000 });
    const phone = info.project.metadata.screenWidth === 'mobile';
    const listUrl = page.url();
    const opened = await openBigCard(page);
    if (phone) {
      expect(opened, 'A phone user must be able to open the article before closing it').toBe(true);
    } else if (!opened) {
      test.skip();
      return;
    }
    const bigCard = page.locator('[data-testid="big-card-container"]');
    await expect(bigCard).toBeVisible({ timeout: 5000 });
    if (phone) {
      await expect(page.getByTestId('shared-topbar-article-close')).toBeHidden();
      await expect(page.getByTestId('big-card-close')).toBeHidden();
      expect(page.url()).not.toBe(listUrl);
      // The phone toolbar has no close button. Opening a card pushes an
      // article history entry, so browser Back returns to the same listing.
      await page.goBack();
      await expect(page).toHaveURL(listUrl);
      await expect(page.getByTestId('card-item').first()).toBeVisible();
    } else {
      await closeBigCard(page);
    }
    // dataset_aliases.js maps the internal app_ name to this public address.
    await expect(page).toHaveURL(/\/service_catalog(?:\?.*)?$/, { timeout: 5000 });
    await expect.poll(() => new URL(page.url()).searchParams.get('view'))
      .not.toBe('article_view');
    await expect(page.locator('[data-testid="big-card-container"]:visible')).toHaveCount(0, { timeout: 5000 });
    await expect(page.locator('.card_view_wrapper.big-card-open')).toHaveCount(0, { timeout: 5000 });
  });
});
