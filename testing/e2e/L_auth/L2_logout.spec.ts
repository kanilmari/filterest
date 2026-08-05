/**
 * L2_logout.spec.ts
 *
 * Tests logout functionality.
 * Logs in using the auth helper, then logs out and verifies the session is destroyed.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, logout, readSessionInfo, type TestCredentials } from '../helpers/auth';
import { ensureNavbarVisible } from '../helpers/navbar';

test.describe('L2 — Logout', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test('logout clears the session and follows the configured logged-out shell', async ({ page }) => {
    await login(page, credentials);
    await ensureNavbarVisible(page);
    await expect(page.locator('[data-testid="navbar-auth-logout"], [data-testid="tab-logout"]').first()).toBeVisible();

    await logout(page);

    const sessionInfo = await readSessionInfo(page);
    expect(typeof sessionInfo.user_id === 'number' ? sessionInfo.user_id : 0).toBeLessThanOrEqual(1);
    await expect(page.locator('[data-testid="navbar-auth-logout"], [data-testid="tab-logout"]')).toHaveCount(0);
    expect(page.url()).not.toContain('/api/logout');

    const navbar = page.locator('#navbar');
    if (await navbar.count()) {
      await ensureNavbarVisible(page);
      await expect(page.locator('[data-testid="navbar-auth-login"], [data-testid="tab-login"]').first()).toBeVisible();
      await page.evaluate(() => {
        const loginButton = document.querySelector(
          '[data-testid="navbar-auth-login"], [data-testid="tab-login"]',
        );
        if (!(loginButton instanceof HTMLElement)) {
          throw new Error('Login action not found after logout.');
        }
        loginButton.click();
      });
    }

    await expect(page.locator('[data-testid="login-form"]')).toBeVisible();
  });
});
