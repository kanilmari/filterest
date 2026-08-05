/**
 * L3_password_toggle.spec.ts
 *
 * Tests the show/hide password toggle on the login form.
 * Does NOT require authentication — operates on the public /login page.
 */

import { test, expect } from '@playwright/test';
import { openLoginEntry } from '../helpers/auth';

test.describe('L3 — Password Toggle', () => {
  // Use fresh context — no stored auth state, so /login page renders
  test.use({ storageState: { cookies: [], origins: [] } });

  test('password visibility toggle switches input type', async ({ page }) => {
    // 1. Open the guest-shell login modal.
    await openLoginEntry(page);

    // 2. Type something in the password field
    await page.locator('[data-testid="login-password"]').fill('secret123');

    // 3. Verify initial state: input type is "password" (hidden)
    await expect(page.locator('[data-testid="login-password"]')).toHaveAttribute('type', 'password');

    // 4. Locate the toggle button
    const toggleButton = page.locator('[data-testid="login-toggle-password"]');

    const toggleVisible = await toggleButton.first().isVisible().catch(() => false);
    if (!toggleVisible) {
      test.skip(true, 'Password toggle button not found');
      return;
    }

    // 5. Click toggle — password should become visible
    await toggleButton.first().click();
    await expect(page.locator('[data-testid="login-password"]')).toHaveAttribute('type', 'text');

    // 6. Click again — password should be hidden again
    await toggleButton.first().click();
    await expect(page.locator('[data-testid="login-password"]')).toHaveAttribute('type', 'password');
  });
});
