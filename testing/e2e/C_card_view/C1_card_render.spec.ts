/**
 * C1_card_render.spec.ts
 *
 * Verifies that card view renders visible cards for the app_service_catalog dataset.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { navigateToDataset } from '../helpers/navigation';
import { switchToView, openBigCard, closeBigCard } from '../helpers/view-switch';

test.describe('C1 — Card View Render', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('card view renders cards', async ({ page }) => {
    await navigateToDataset(page, 'app_service_catalog');
    await switchToView(page, 'card');
    const cards = page.locator('[data-testid="card-item"]');
    await expect(cards.first()).toBeVisible({ timeout: 10000 });
    const count = await cards.count();
    expect(count).toBeGreaterThan(0);
  });
});
