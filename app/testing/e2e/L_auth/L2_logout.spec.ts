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

    await page.evaluate(() => {
      localStorage.setItem('theme', 'light');
      localStorage.setItem('chosen_language', 'fi');
      localStorage.setItem('navVisibleWide', 'false');
      localStorage.setItem('navVisibleNarrow', 'true');
      localStorage.setItem('secret_table_hide_columns', '{"restricted_field":true}');
      localStorage.setItem(
        'secret_table_sorting_and_filtering_specs',
        '{"filters":{"secret":"x"}}',
      );
    });

    const currentAuthCookieNames = (await page.context().cookies())
      .map((cookie) => cookie.name)
      .filter((name) => /^(session|device_id|fingerprint)_.+_[0-9a-f]{10}$/.test(name));
    const siblingCookieNames = [
      'session_sibling_deadbeef00',
      'device_id_sibling_deadbeef00',
      'fingerprint_sibling_deadbeef00',
    ];
    await page.context().addCookies(
      siblingCookieNames.map((name) => ({
        name,
        value: 'sibling-instance-value',
        url: new URL(page.url()).origin,
        secure: true,
        sameSite: 'Lax' as const,
      })),
    );

    const logoutResponsePromise = page.waitForResponse(
      (response) => response.url().endsWith('/api/logout'),
    );
    await logout(page);

    const logoutResponse = await logoutResponsePromise;
    const setCookieHeader = (await logoutResponse.allHeaders())['set-cookie'] || '';
    for (const currentName of currentAuthCookieNames) {
      expect(setCookieHeader).toContain(`${currentName}=`);
    }
    for (const siblingName of siblingCookieNames) {
      expect(setCookieHeader).not.toContain(`${siblingName}=`);
    }

    // The redirected guest shell may create fresh current-instance cookies.
    // Sibling-instance cookies must remain untouched throughout the flow.
    const namesAfterLogout = (await page.context().cookies()).map((cookie) => cookie.name);
    expect(namesAfterLogout).toEqual(expect.arrayContaining(siblingCookieNames));

    const sessionInfo = await readSessionInfo(page);
    expect(typeof sessionInfo.user_id === 'number' ? sessionInfo.user_id : 0).toBeLessThanOrEqual(1);
    await expect(page.locator('[data-testid="navbar-auth-logout"], [data-testid="tab-logout"]')).toHaveCount(0);
    expect(page.url()).not.toContain('/api/logout');

    const logoutStorage = await page.evaluate(() => ({
      theme: localStorage.getItem('theme'),
      language: localStorage.getItem('chosen_language'),
      navVisibleWide: localStorage.getItem('navVisibleWide'),
      navVisibleNarrow: localStorage.getItem('navVisibleNarrow'),
      tableVisibility: localStorage.getItem('secret_table_hide_columns'),
      tableFiltering: localStorage.getItem('secret_table_sorting_and_filtering_specs'),
    }));
    expect(logoutStorage).toEqual({
      theme: 'light',
      language: 'fi',
      navVisibleWide: 'false',
      navVisibleNarrow: 'true',
      tableVisibility: null,
      tableFiltering: null,
    });

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
