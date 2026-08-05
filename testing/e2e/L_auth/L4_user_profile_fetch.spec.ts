/**
 * L4_user_profile_fetch.spec.ts
 *
 * Tests that the user profile API returns valid data after successful login.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';

test.describe('L4 — User Profile Fetch', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test('user profile API returns valid data after login', async ({ page }) => {
    // 1. Log in
    await login(page, credentials);

    // 2. Fetch /api/user-profile using the authenticated session cookie
    const profile = await page.evaluate(() =>
      fetch('/api/user-profile', { credentials: 'include' }).then((r) => r.json()),
    );

    // 3. Verify the response contains at least one expected identity field
    expect(profile).toBeTruthy();
    const hasIdentityField =
      typeof profile.username === 'string' ||
      typeof profile.email === 'string' ||
      typeof profile.user_id === 'number' ||
      typeof profile.user_id === 'string' ||
      typeof profile.id === 'number' ||
      typeof profile.id === 'string';

    expect(hasIdentityField).toBe(true);
  });
});
