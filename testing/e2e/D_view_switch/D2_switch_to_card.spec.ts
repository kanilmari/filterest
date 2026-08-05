/**
 * D2_switch_to_card.spec.ts
 *
 * Tests switching to card view using the view selector button.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { navigateToDataset, waitForDataLoaded } from '../helpers/navigation';
import { switchToView } from '../helpers/view-switch';

test.describe('D2 — Switch to Card View', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('can switch to card view', async ({ page }) => {
    await navigateToDataset(page, 'app_service_catalog');
    await waitForDataLoaded(page, 'app_service_catalog');

    // Establish a different active surface so this test must exercise the
    // card-view control instead of passing on the dataset's default view.
    await switchToView(page, 'table');
    await switchToView(page, 'card');

    const cards = page.locator('[data-testid="card-item"]');
    await expect(cards.first()).toBeVisible({ timeout: 10000 });
  });

  test('card view displays data', async ({ page }) => {
    await navigateToDataset(page, 'app_service_catalog');
    await waitForDataLoaded(page, 'app_service_catalog');

    await switchToView(page, 'table');
    await switchToView(page, 'card');

    const cardItems = page.locator('[data-testid="card-item"]');
    await expect(cardItems.first()).toBeVisible({ timeout: 10000 });
    const count = await cardItems.count();
    expect(count).toBeGreaterThan(0);
  });
});
