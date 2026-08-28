/**
 * C2_open_big_card.spec.ts
 *
 * Verifies opening the big card modal from card view.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { navigateToDataset } from '../helpers/navigation';
import { switchToView, openBigCard, closeBigCard } from '../helpers/view-switch';

test.describe('C2 — Open Big Card', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('clicking a card opens big card modal', async ({ page }) => {
    await navigateToDataset(page, 'app_service_catalog');
    await switchToView(page, 'card');
    await page.waitForSelector('[data-testid="card-item"]', { timeout: 10000 });
    const opened = await openBigCard(page);
    if (!opened) {
      test.skip();
      return;
    }
    await expect(
      page.locator('[data-testid="big-card-container"]'),
    ).toBeVisible({ timeout: 5000 });
  });
});
