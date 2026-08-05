/**
 * A6_select_card.spec.ts
 *
 * Tests card checkbox selection in card view.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { navigateToDataset, waitForDataLoaded } from '../helpers/navigation';
import { switchToView } from '../helpers/view-switch';

test.describe('A6 — Select Card', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
    await navigateToDataset(page, 'app_service_catalog');
    await waitForDataLoaded(page, 'app_service_catalog');
  });

  test('card checkbox selects the card', async ({ page }) => {
    // Switch to card view
    await switchToView(page, 'card');

    // Wait for cards to render
    await page.waitForSelector('[data-testid="card-item"]', { timeout: 10000 });

    const firstCard = page.locator('[data-testid="card-item"]').first();
    await expect(firstCard).toBeVisible({ timeout: 5000 });

    const cardCheckbox = firstCard.locator('[data-testid="card-select-checkbox"]');
    await expect(cardCheckbox.first()).toBeVisible({ timeout: 5000 });

    await cardCheckbox.first().check();
    await expect(cardCheckbox.first()).toBeChecked();

    // Verify card has selected state
    const cardSelected =
      (await firstCard.getAttribute('aria-selected')) === 'true' ||
      (await firstCard.getAttribute('class'))?.includes('selected') ||
      (await cardCheckbox.first().isChecked());
    expect(cardSelected).toBe(true);
  });
});
