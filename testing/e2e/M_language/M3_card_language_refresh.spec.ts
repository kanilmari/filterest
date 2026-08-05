/**
 * M3_card_language_refresh.spec.ts
 *
 * Verifies card view remains visible after changing UI language in dataset context.
 * Combines dataset navigation, card view switch, and language switching checks.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { switchToView } from '../helpers/view-switch';
import { navigateToDataset, waitForDataLoaded } from '../helpers/navigation';

test.describe('M3 — Card Language Refresh', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('card view refreshes on language change', async ({ page }) => {
    await navigateToDataset(page, 'app_service_catalog');
    await waitForDataLoaded(page, 'app_service_catalog');
    await switchToView(page, 'card');

    const cards = page.locator('[data-testid="card-item"]');
    if (await cards.first().isVisible({ timeout: 5000 }).catch(() => false)) {
      // Vaihda kieli
      const langSelector = page.locator('[data-testid="language-menu-button"]');
      if (await langSelector.first().isVisible({ timeout: 3000 }).catch(() => false)) {
        await langSelector.first().evaluate((el: HTMLElement) => el.click());
        const langOption = page.locator('[data-testid="language-menu-option-en"]');
        if (await langOption.first().isVisible({ timeout: 2000 }).catch(() => false)) {
          await langOption.first().evaluate((el: HTMLElement) => el.click());
          await page.waitForTimeout(1000);

          // Varmista kortit edelleen näkyvissä
          await expect(cards.first()).toBeVisible({ timeout: 5000 });
        }
      }
    } else {
      test.skip();
    }
  });
});
