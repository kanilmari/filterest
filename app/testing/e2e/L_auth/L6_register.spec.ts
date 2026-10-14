// L6_register.spec.ts
// Verifies registration availability, credential hints and the neutral completion notice.
// Connects the SPA registration form with the existing account creation endpoint.
// Removes only this test's generated public username, even after assertion failures.
import { randomUUID } from 'node:crypto';
import { test, expect, request as playwrightRequest, type APIRequestContext } from '@playwright/test';
import { fetchCsrfTokenForRequest } from '../helpers/test-artifact-csrf-reader';
import { resolveFilterestTestRuntimePaths } from '../helpers/test-runtime-paths';

type RegisteredAccount = { id: number; username: string; full_name: string; admin_access_allowed: boolean | null };

/** Equal bounds and strict readback keep cleanup limited to one generated public username. */
async function readRegisteredAccount(admin: APIRequestContext, username: string): Promise<RegisteredAccount | null> {
  const response = await admin.get('/api/get-results', {
    params: { dataset: 'system_users', view_key: 'table', username_from: username, username_to: username },
  });
  expect(response.ok()).toBe(true);
  const { data } = await response.json() as { data: RegisteredAccount[] };
  expect(Array.isArray(data)).toBe(true);
  expect(data.length).toBeLessThanOrEqual(1);
  if (!data.length) return null;
  expect(data[0].username).toBe(username);
  expect(Number.isSafeInteger(data[0].id) && data[0].id > 1).toBe(true);
  return data[0];
}

test.describe('L6 — Register', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  let cleanup: {
    admin: APIRequestContext; username: string; submission: Promise<void> | null; accountId: number | null;
  } | null;

  test.beforeEach(async ({ page }) => {
    cleanup = null;
    // Registration stays signed out; pin its isolated guest theme without changing an account preference.
    await page.addInitScript(() => localStorage.setItem('theme', 'light'));
  });

  test.afterEach(async () => {
    if (!cleanup) return;
    const { admin, username, submission, accountId } = cleanup;
    try {
      if (!submission) return;
      // Drain an in-flight submit even if the click/assertion failed before its reply arrived.
      await submission;
      const account = await readRegisteredAccount(admin, username);
      if (!account) {
        expect(accountId, 'A confirmed account must still be identifiable for cleanup.').toBeNull();
        return;
      }
      if (accountId !== null) expect(account.id, 'Refusing to delete a replacement account.').toBe(accountId);
      expect(account.full_name).toBe('SPA Register Test');
      expect(account.admin_access_allowed).not.toBe(true);
      const csrf = await fetchCsrfTokenForRequest(admin);
      const deletion = await admin.post('/api/delete-rows?dataset=system_users', {
        headers: { 'X-CSRF-Token': csrf }, data: { ids: [account.id] },
      });
      expect(deletion.ok()).toBe(true);
      expect(await readRegisteredAccount(admin, username)).toBeNull();
      // Registration creates an ordinary membership; the user FK must cascade with the profile row.
      for (const dataset of ['system_users', 'system_user_group_memberships']) {
        const column = dataset === 'system_users' ? 'id' : 'user_id';
        const response = await admin.get('/api/get-results', {
          params: { dataset, view_key: 'table', [`${column}_from`]: account.id, [`${column}_to`]: account.id },
        });
        expect(response.ok()).toBe(true);
        expect((await response.json()).data).toEqual([]);
      }
    } finally {
      await admin.dispose();
      cleanup = null;
    }
  });

  test('register route respects environment toggle and shows success status when enabled', async ({ page, request, baseURL }) => {
    const authModesResponse = await request.get('/api/auth-modes');
    const authModes = await authModesResponse.json();

    if (!authModes.registration_enabled) {
      const disabledResponse = await request.get('/register_ndYOyXV0INOK3F');
      expect(disabledResponse.status()).toBe(403);
      await expect(disabledResponse.text()).resolves.toContain('Registration is disabled');
      return;
    }

    const uniqueSuffix = `${Date.now()}_${randomUUID()}`;
    // register.go stores display_name in system_users.username; the private sign-in name is not public API data.
    const username = `Registration Display ${uniqueSuffix}`;
    const admin = await playwrightRequest.newContext({
      baseURL, ignoreHTTPSErrors: true,
      storageState: resolveFilterestTestRuntimePaths().authStorageState,
      extraHTTPHeaders: { 'X-Bypass-Ratelimit': 'test-mode' },
    });
    cleanup = { admin, username, submission: null, accountId: null };
    expect((await admin.get('/api/admin/version-info')).ok()).toBe(true);
    expect(await readRegisteredAccount(admin, username), 'Generated username must be absent before registration.').toBeNull();

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
    await page.locator('[data-testid="register-display-name"]').fill(username);
    await page.locator('[data-testid="register-password"]').fill('TestPassword123!');
    await page.locator('[data-testid="register-email"]').fill(`spa_register_${uniqueSuffix}@example.com`);
    await page.locator('[data-testid="register-full-name"]').fill('SPA Register Test');

    await expect(page.locator('[data-testid="register-verification-fixed-pin"]')).toBeVisible();
    await expect(page.locator('[data-testid="register-verification-none"]')).toBeVisible();
    await page.locator('[data-testid="register-verification-none"]').check();
    await expect(page.locator('[data-register-verification-fields="fixed_pin"]')).toBeHidden();

    const registered = page.waitForResponse(response => (
      new URL(response.url()).pathname === '/api/register_ndYOyXV0INOK3F'
      && response.request().method() === 'POST'
    ));
    // Attach the rejection handler immediately; afterEach still checks for a committed account on request failure.
    cleanup.submission = registered.then(() => undefined, () => undefined);
    await page.locator('[data-testid="register-submit"]').click();
    await registered;
    const account = await readRegisteredAccount(admin, username);
    expect(account).not.toBeNull();
    cleanup.accountId = account!.id;

    await expect(page.locator('[data-registration-complete]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-registration-complete]')).toHaveAttribute('data-lang-key', 'registration_account_created');
    await expect(page.locator('[data-registration-complete]')).toHaveText(/^(Tili on luotu\.|Your account has been created\.|您的账户已创建。|你嘅帳戶已經建立咗。)$/);
    await expect(page.locator('[data-testid="register-form"] a[data-lang-key="login"]')).toHaveAttribute('href', '/login');
    await expect(page.locator('[data-testid="register-username"]')).toHaveCount(0);
  });
});
