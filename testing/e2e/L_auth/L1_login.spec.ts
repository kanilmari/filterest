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
  });
});
