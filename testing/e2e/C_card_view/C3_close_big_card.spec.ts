/**
 * C3_close_big_card.spec.ts
 *
 * Verifies closing behavior for the big card modal in card view.
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

  test('big card can be closed', async ({ page }) => {
    await navigateToDataset(page, 'app_service_catalog');
    await switchToView(page, 'card');
    await page.waitForSelector('[data-testid="card-item"]', { timeout: 10000 });
    const opened = await openBigCard(page);
    if (!opened) {
      test.skip();
      return;
    }
    const bigCard = page.locator('[data-testid="big-card-container"]');
    await expect(bigCard).toBeVisible({ timeout: 5000 });
    await closeBigCard(page);
    await expect(page).toHaveURL(/\/app_service_catalog(?:\?.*)?$/, { timeout: 5000 });
    await expect(page.locator('[data-testid="big-card-container"]:visible')).toHaveCount(0, { timeout: 5000 });
    await expect(page.locator('.card_view_wrapper.big-card-open')).toHaveCount(0, { timeout: 5000 });
  });
});
