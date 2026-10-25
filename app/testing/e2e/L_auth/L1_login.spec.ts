// L1_login.spec.ts
// Verifies the login form directly without relying on the shared login helper.
// Bridges protected browser-test credentials with the user-visible authentication flow.
// Exists so successful sign-in and redirect behavior have independent coverage.

import { test, expect } from '@playwright/test';
import {
  loadCredentials,
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

    // Keep a real guest token in the same API cache the first signed-in write
    // will use. The document marker and request counts expose reload/retry loops.
    const preSignInToken = await page.evaluate(async () => {
      const { ensureCsrfToken } = await import('/frontend/core_components/pipeline/api_pipeline.js');
      document.documentElement.dataset.signInDocumentProof = 'same-document';
      return ensureCsrfToken();
    });
    expect(Boolean(preSignInToken)).toBe(true);
    const profileWritePath = await page.evaluate(async () => {
      const { getEndpointUrl } = await import('/frontend/core_components/pipeline/api_pipeline.js');
      return new URL(getEndpointUrl('updateUserProfile'), window.location.href).pathname;
    });
    const documentRequests: string[] = [];
    const loginRequests: string[] = [];
    const profileWrites: { usedNewToken: boolean; status: number }[] = [];
    const csrfRefusals: Promise<boolean>[] = [];
    page.on('request', (request) => {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
        documentRequests.push(request.url());
      }
      if (new URL(request.url()).pathname === '/api/login' && request.method() === 'POST') {
        loginRequests.push(request.url());
      }
    });
    page.on('response', (response) => {
      const request = response.request();
      if (response.status() === 403 && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) {
        csrfRefusals.push(response.text().then((body) => /csrf/i.test(body)));
      }
      if (new URL(request.url()).pathname === profileWritePath && request.method() === 'POST') {
        const csrf = request.headers()['x-csrf-token'];
        profileWrites.push({ usedNewToken: Boolean(csrf) && csrf !== preSignInToken, status: response.status() });
      }
    });

    const privacyLabel = page.locator('.privacy-notice-link label');
    await expect(privacyLabel.locator('a')).toHaveCount(1);
    await expect(privacyLabel.locator('a')).toHaveText('privacy notice');
    await expect(privacyLabel.locator('[data-lang-key="privacy_notice_login_acceptance_prefix"]'))
      .toContainText('To sign in');
    await expect(privacyLabel.locator('[data-lang-key="privacy_notice_login_acceptance_suffix"]'))
      .toHaveText('.');

    // 2. Read credentials from the protected mutable credential scope.
    const { username, password } = loadCredentials();

    for (const [id, hint] of [
      ['login-username', 'username'],
      ['login-password', 'current-password'],
      ['login-otp', 'one-time-code'],
      ['login-password-reset-otp', 'off'],
      ['login-password-reset-new-password', 'new-password'],
    ]) {
      await expect(page.getByTestId(id)).toHaveAttribute('autocomplete', hint);
    }

    // 3. Fill credentials (Phase 1)
    await page.locator('[data-testid="login-username"]').fill(username);
    await page.locator('[data-testid="login-password"]').fill(password);

    const privacyCheckbox = page.locator('[data-testid="login-privacy-accept"]');
    if (!(await privacyCheckbox.isChecked())) {
      await privacyCheckbox.check();
    }

    // 4. Submit credentials → OTP section appears
    const otpRequired = await submitCredentialsAndWaitForOtp(page);

    if (otpRequired) {
      // 5. Fill the explicitly configured native dev OTP.
      await page.locator('[data-testid="login-otp"]').fill(loadOtpCode());
      await submitCredentialsAndWaitForOtp(page);
    }

    // 6. Verify we end up inside the authenticated app shell.
    await waitForAuthenticatedApp(page);
    expect(page.url()).not.toContain('/login');

    // Save the reserved test account's existing website unchanged: a real,
    // CSRF-protected write that needs no instance settings or test-data cleanup.
    const writeSucceeded = await page.evaluate(async () => {
      const { runApiPipeline } = await import('/frontend/core_components/pipeline/api_pipeline.js');
      const profile = await runApiPipeline({ routeName: 'fetchUserProfile' });
      const result = await runApiPipeline({
        routeName: 'updateUserProfile', method: 'POST',
        bodyData: { website: profile.parsedData.website || '' },
      });
      return result.parsedData?.success === true;
    });
    expect(writeSucceeded).toBe(true);
    expect(profileWrites).toHaveLength(1);
    expect(profileWrites[0].status).toBe(200);
    expect(profileWrites[0].usedNewToken).toBe(true);
    expect(loginRequests).toHaveLength(otpRequired ? 2 : 1);
    // Include bootstrap writes too: a retry there must not repair the cache and
    // conceal a stale first token before the explicit profile action runs.
    expect(await Promise.all(csrfRefusals)).not.toContain(true);
    expect(documentRequests).toEqual([]);
    await expect(page.locator('html')).toHaveAttribute('data-sign-in-document-proof', 'same-document');

    const cookies = await page.context().cookies();
    const cookieNames = cookies.map((cookie) => cookie.name);
    expect(cookieNames).toEqual(expect.arrayContaining([
      expect.stringMatching(/^session_.+_[0-9a-f]{10}(?:_[0-9]{1,5})?$/),
      expect.stringMatching(/^device_id_.+_[0-9a-f]{10}(?:_[0-9]{1,5})?$/),
      expect.stringMatching(/^fingerprint_.+_[0-9a-f]{10}(?:_[0-9]{1,5})?$/),
    ]));
    for (const legacyName of ['session', 'device_id', 'fingerprint']) {
      expect(cookieNames).not.toContain(legacyName);
    }

    const currentAuthCookieNames = cookieNames.filter((name) =>
      /^(session|device_id|fingerprint)_.+_[0-9a-f]{10}(?:_[0-9]{1,5})?$/.test(name),
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

    // Leave the app before the reset: the app's own requests keep writing the
    // sign-in (every protected request renews all three cookies, and the
    // auth-modes request writes the session), so one still in flight could write
    // them back after the reset expired them. The reset then goes through the
    // context's own request client, which shares and updates its cookies.
    const origin = new URL(page.url()).origin;
    await page.goto('about:blank');
    const resetResponse = await page.context().request.post(`${origin}/api/reset-session`, {
      headers: { Origin: origin },
    });
    expect(resetResponse.status()).toBe(200);

    const namesAfterReset = (await page.context().cookies()).map((cookie) => cookie.name);
    for (const currentName of currentAuthCookieNames) {
      expect(namesAfterReset).not.toContain(currentName);
    }
    expect(namesAfterReset).toEqual(expect.arrayContaining(siblingCookieNames));
  });
});
