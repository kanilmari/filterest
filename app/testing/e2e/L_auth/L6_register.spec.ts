// L6_register.spec.ts
// Verifies registration availability, credential hints and the neutral completion notice.
// Connects the SPA registration form with the existing account creation endpoint.
// Keeps browser credentials separate from PIN verification and welcome-email delivery.
import { test, expect } from '@playwright/test';

test.describe('L6 — Register', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('register route respects environment toggle and shows success status when enabled', async ({ page, request }) => {
    const authModesResponse = await request.get('/api/auth-modes');
    const authModes = await authModesResponse.json();

    if (!authModes.registration_enabled) {
      const disabledResponse = await request.get('/register_ndYOyXV0INOK3F');
      expect(disabledResponse.status()).toBe(403);
      await expect(disabledResponse.text()).resolves.toContain('Registration is disabled');
      return;
    }

    const uniqueSuffix = Date.now();

    await page.goto('/register_ndYOyXV0INOK3F', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => !window.location.pathname.startsWith('/register_ndYOyXV0INOK3F'),
      undefined,
      { timeout: 10000 }
    );

    await expect(page.locator('[data-testid="register-username"]')).toHaveAttribute('autocomplete', 'username');
    await expect(page.locator('[data-testid="register-password"]')).toHaveAttribute('autocomplete', 'new-password');
    for (const id of ['register-fixed-pin', 'register-fixed-pin-confirmation']) {
      await expect(page.getByTestId(id)).toHaveAttribute('autocomplete', 'one-time-code');
      await expect(page.getByTestId(id)).toHaveAttribute('type', 'password');
      await expect(page.getByTestId(id)).toHaveAttribute('inputmode', 'numeric');
    }
    await page.locator('[data-testid="register-username"]').fill(`spa_register_${uniqueSuffix}`);
    await page.locator('[data-testid="register-display-name"]').fill(`Registration Display ${uniqueSuffix}`);
    await page.locator('[data-testid="register-password"]').fill('TestPassword123!');
    await page.locator('[data-testid="register-email"]').fill(`spa_register_${uniqueSuffix}@example.com`);
    await page.locator('[data-testid="register-full-name"]').fill('SPA Register Test');

    await expect(page.locator('[data-testid="register-verification-fixed-pin"]')).toBeVisible();
    await expect(page.locator('[data-testid="register-verification-none"]')).toBeVisible();
    await page.locator('[data-testid="register-verification-none"]').check();
    await expect(page.locator('[data-register-verification-fields="fixed_pin"]')).toBeHidden();

    await page.locator('[data-testid="register-submit"]').click();

    await expect(page.locator('[data-registration-complete]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-registration-complete]')).toHaveAttribute('data-lang-key', 'registration_account_created');
    await expect(page.locator('[data-registration-complete]')).toHaveText(/^(Tili on luotu\.|Your account has been created\.|您的账户已创建。|你嘅帳戶已經建立咗。)$/);
    await expect(page.locator('[data-testid="register-form"] a[data-lang-key="login"]')).toHaveAttribute('href', '/login');
    await expect(page.locator('[data-testid="register-username"]')).toHaveCount(0);
  });
});
