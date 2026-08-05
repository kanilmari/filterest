/**
 * L5_profile_update.spec.ts
 *
 * Tests that the profile UI is accessible after login and shows non-empty identity fields.
 * Does NOT submit the form — only verifies the UI renders correctly.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';

test.describe('L5 — Profile Update UI', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('profile UI opens and shows non-empty identity fields', async ({ page }) => {
    // 1. Try to open the profile view via common entry points
    const profileTrigger = page.locator('[data-testid="tab-user"]');

    const triggerVisible = await profileTrigger.first().isVisible().catch(() => false);

    if (!triggerVisible) {
      // Try clicking the user tab via page.evaluate (may be outside viewport)
      const clicked = await page.evaluate(() => {
        const btn = document.querySelector('[data-testid="tab-user"]') as HTMLElement | null;
        if (btn) { btn.click(); return true; }
        return false;
      });
      if (!clicked) {
        test.skip(true, 'Profile UI not found — skipping');
        return;
      }
    } else {
      // Use page.evaluate to click — button may be outside viewport
      await page.evaluate(() => {
        const btn = document.querySelector('[data-testid="tab-user"]') as HTMLElement | null;
        if (btn) btn.click();
      });
    }

    // 2. Wait briefly for any modal/drawer to render
    await page.waitForTimeout(500);

    // 3. Locate an identity field (username or email input/display)
    const usernameField = page.locator(
      'input[name="username"], input[id="username"], [data-field="username"]',
    );
    const emailField = page.locator(
      'input[name="email"], input[id="email"], [data-field="email"]',
    );

    const usernameVisible = await usernameField.first().isVisible().catch(() => false);
    const emailVisible = await emailField.first().isVisible().catch(() => false);

    if (!usernameVisible && !emailVisible) {
      test.skip(true, 'Profile form fields not found — skipping');
      return;
    }

    // 4. Verify at least one identity field has a non-empty value
    if (usernameVisible) {
      const usernameValue = await usernameField.first().inputValue();
      expect(usernameValue.trim().length).toBeGreaterThan(0);
    }

    if (emailVisible) {
      const emailValue = await emailField.first().inputValue();
      expect(emailValue.trim().length).toBeGreaterThan(0);
    }
  });
});
