import { test, expect } from '@playwright/test';

test.describe('L6 — Register', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('register route respects environment toggle and hands off to login when enabled', async ({ page, request }) => {
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

    await page.locator('[data-testid="register-username"]').fill(`spa_register_${uniqueSuffix}`);
    await page.locator('[data-testid="register-password"]').fill('TestPassword123!');
    await page.locator('[data-testid="register-email"]').fill(`spa_register_${uniqueSuffix}@example.com`);
    await page.locator('[data-testid="register-full-name"]').fill('SPA Register Test');
    await page.locator('[data-testid="register-submit"]').click();

    await page.locator('[data-testid="login-form"]').waitFor({ state: 'visible', timeout: 10000 });
    expect(page.url()).not.toContain('/register_ndYOyXV0INOK3F');
    await expect(page.locator('[data-testid="login-username"]')).toBeVisible();
  });
});
