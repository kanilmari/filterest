/**
 * L7_admin_user_authentication.spec.ts
 *
 * Verifies the administrator-only user authentication surface without changing an account.
 * Bridges the admin navigation tree, the protected method-only API, and the factor controls.
 * Exists so password-only access stays an explicit choice instead of a database-only operation.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { expandAdminTreeFolder, openAdminTreeButton } from '../helpers/admin-navigation';
import { waitForAppReady } from '../helpers/navigation';

test.describe('L7 — Administrator user authentication', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
    await waitForAppReady(page);
  });

  test('offers password-only, fixed-PIN, and email choices without exposing a secret', async ({ page }) => {
    await expandAdminTreeFolder(page, 'site_settings');
    await openAdminTreeButton(page, 'user_authentication');

    const userSelect = page.locator('[data-testid="user-authentication-user"]');
    await expect(userSelect).toBeVisible({ timeout: 10_000 });
    expect(await userSelect.locator('option').count()).toBeGreaterThan(1);

    await userSelect.selectOption({ index: 1 });
    await expect(page.locator('[data-testid="verification-method-none"]')).toBeVisible();
    await expect(page.locator('[data-testid="verification-method-fixed_pin"]')).toBeVisible();
    await expect(page.locator('[data-testid="verification-method-email"]')).toBeVisible();
    await expect(page.locator('[data-testid="user-authentication-save"]')).toBeVisible();

    await page.locator('[data-testid="verification-method-none"]').check();
    await expect(page.locator('[data-testid="user-authentication-fixed-pin"]')).toBeHidden();
    await expect(page.locator('[data-testid="user-authentication-fixed-pin-confirmation"]')).toBeHidden();
  });
});
