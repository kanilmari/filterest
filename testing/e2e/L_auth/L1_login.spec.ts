/**
 * L1_login.spec.ts
 *
 * Tests the login form directly — does NOT use the auth helper's login() function.
 * Verifies that submitting valid credentials redirects to the app home page.
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import {
  loadOtpCode,
  openLoginEntry,
  submitCredentialsAndWaitForOtp,
  waitForAuthenticatedApp,
} from '../helpers/auth';

test.describe('L1 — Login', () => {
  // Use fresh context — no stored auth state
  test.use({ storageState: { cookies: [], origins: [] } });

  test('login form submits and redirects to app', async ({ page }) => {
    // 1. Open the guest-shell login modal.
    await openLoginEntry(page);

    const privacyLabel = page.locator('.privacy-notice-link label');
    await expect(privacyLabel.locator('a')).toHaveCount(1);
    await expect(privacyLabel.locator('a')).toHaveText('privacy notice');
    await expect(privacyLabel.locator('[data-lang-key="privacy_notice_login_acceptance_prefix"]'))
      .toContainText('To sign in');
    await expect(privacyLabel.locator('[data-lang-key="privacy_notice_login_acceptance_suffix"]'))
      .toHaveText('.');

    // 2. Read credentials from dev_env_test_creds.txt
    const creds = fs.readFileSync('dev_env_test_creds.txt', 'utf8');
    const username =
      creds
        .split('\n')
        .find((l) => l.startsWith('TEST_ADMIN_USER='))
        ?.split('=')[1]
        ?.trim() ?? 'admin';
    const password =
      creds
        .split('\n')
        .find((l) => l.startsWith('TEST_ADMIN_PASS='))
        ?.split('=')[1]
        ?.trim() ?? 'password';

    // 3. Fill credentials (Phase 1)
    await page.locator('[data-testid="login-username"]').fill(username);
    await page.locator('[data-testid="login-password"]').fill(password);

    const privacyCheckbox = page.locator('[data-testid="login-privacy-accept"]');
    if (!(await privacyCheckbox.isChecked())) {
      await privacyCheckbox.check();
    }

    // 4. Submit credentials → OTP section appears
    await submitCredentialsAndWaitForOtp(page);

    // 5. Fill the explicitly configured native dev OTP.
    await page.locator('[data-testid="login-otp"]').fill(loadOtpCode());
    await page.locator('[data-testid="login-submit"]').click();

    // 6. Verify we end up inside the authenticated app shell.
    await waitForAuthenticatedApp(page, username);
    expect(page.url()).not.toContain('/login');

    const cookies = await page.context().cookies();
    const cookieNames = cookies.map((cookie) => cookie.name);
    expect(cookieNames).toEqual(expect.arrayContaining([
      expect.stringMatching(/^session_.+_[0-9a-f]{10}$/),
      expect.stringMatching(/^device_id_.+_[0-9a-f]{10}$/),
      expect.stringMatching(/^fingerprint_.+_[0-9a-f]{10}$/),
    ]));
    for (const legacyName of ['session', 'device_id', 'fingerprint']) {
      expect(cookieNames).not.toContain(legacyName);
    }

    const currentAuthCookieNames = cookieNames.filter((name) =>
      /^(session|device_id|fingerprint)_.+_[0-9a-f]{10}$/.test(name),
    );
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

    const resetStatus = await page.evaluate(async () => {
      const response = await fetch('/api/reset-session', { method: 'POST' });
      return response.status;
    });
    expect(resetStatus).toBe(200);

    const namesAfterReset = (await page.context().cookies()).map((cookie) => cookie.name);
    for (const currentName of currentAuthCookieNames) {
      expect(namesAfterReset).not.toContain(currentName);
    }
    expect(namesAfterReset).toEqual(expect.arrayContaining(siblingCookieNames));
  });
});
