/**
 * M2_translation_key.spec.ts
 *
 * Verifies that translation-marked DOM nodes exist and contain non-empty text.
 * Navigates to a dataset first to ensure data-lang-key elements are rendered.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { navigateToDataset } from '../helpers/navigation';

test.describe('M2 — Translation Key Render', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('data-lang-key elements have translated text', async ({ page }) => {
    // Navigate to a dataset so the full UI renders with lang-key elements
    await navigateToDataset(page, 'app_service_catalog');

    // Wait for translations to load (MutationObserver applies them).
    // Use state: 'attached' because the first [data-lang-key] element in DOM
    // order may be hidden (e.g. language dropdown label), blocking visibility wait.
    await page.waitForSelector('[data-lang-key]', { state: 'attached', timeout: 15000 });
    await page.waitForTimeout(1500); // Allow MutationObserver to process

    const langKeyElements = page.locator('[data-lang-key]');
    const count = await langKeyElements.count();
    expect(count).toBeGreaterThan(0);

    // Check that at least some elements have non-empty translated text
    let translatedCount = 0;
    for (let i = 0; i < Math.min(count, 10); i++) {
      const el = langKeyElements.nth(i);
      const text = (await el.textContent())?.trim() ?? '';
      const key = await el.getAttribute('data-lang-key') ?? '';

      // Element has text and it's not the raw key → translation is working
      if (text.length > 0 && text !== key) {
        translatedCount++;
      }
    }
    // At least 1 element should be translated (some may be icon-only placeholders)
    expect(translatedCount).toBeGreaterThan(0);
  });
});
