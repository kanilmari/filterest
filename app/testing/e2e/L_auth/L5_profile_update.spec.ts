/**
 * L5_profile_update.spec.ts
 *
 * Tests that the profile UI is accessible after login and shows non-empty identity fields.
 * Does NOT submit the form — only verifies the UI renders correctly.
 * A missing account control or profile field fails the test instead of skipping it.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';

// The navbar prints the signed-in account control; older layouts printed it as a main tab.
const ACCOUNT_CONTROL = '[data-testid="navbar-auth-user"], [data-testid="tab-user"]';

test.describe('L5 — Profile Update UI', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('profile UI opens and shows non-empty identity fields', async ({ page }) => {
    // 1. The signed-in account's identity, as the profile form loads it.
    const profileResponse = await page.request.get('/api/user-profile');
    expect(profileResponse.status()).toBe(200);
    const profile = await profileResponse.json();
    expect(profile.username, 'Display name of the signed-in account').toMatch(/\S/);

    // 2. Open the profile through the account control. The navbar renders after
    //    sign-in, and Playwright reports the button outside the viewport, so it is
    //    clicked in-page.
    await page.locator(ACCOUNT_CONTROL).first().waitFor({ state: 'attached', timeout: 15_000 });
    await page.evaluate((selector) => {
      const button = document.querySelector(selector);
      if (!(button instanceof HTMLElement)) throw new Error('Account profile control missing.');
      button.click();
    }, ACCOUNT_CONTROL);

    // 3. The public display name (#edit_username since WL132) and the email show the stored values.
    const displayName = page.locator('#edit_username');
    await expect(displayName).toBeVisible();
    await expect(displayName).toHaveValue(profile.username);

    const email = page.locator('#edit_email');
    await expect(email).toBeVisible();
    await expect(email).toHaveValue(profile.email);

    // 4. The private login name has its own change field, which is never prefilled.
    const loginName = page.locator('#new_login_name');
    await expect(loginName).toBeVisible();
    await expect(loginName).toHaveValue('');
  });
});
