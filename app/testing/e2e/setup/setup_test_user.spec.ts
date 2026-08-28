// setup_test_user.spec.ts
// Verifies the startup-created reserved dev admin account for E2E tests.
// Bridges Playwright setup, protected mutable credentials, and the backend startup fixture.
// Exists so tests use deterministic credentials instead of creating random admin users.
import { test, expect } from '@playwright/test';
import {
  loadOtpCode,
  openLoginEntry,
  submitCredentialsAndWaitForOtp,
  waitForAuthenticatedApp,
  writeTestCredentialsFile,
} from '../helpers/auth';

test.use({ storageState: { cookies: [], origins: [] } });

test('reserved dev test admin can log in', async ({ page }) => {
  const username = 'test_admin';
  const password = process.env.TEST_ADMIN_PASS || 'TestPassword123!';

  const creds = `TEST_ADMIN_USER=${username}\nTEST_ADMIN_PASS=${password}\nTEST_USER_USER=test_user\nTEST_USER_PASS=${process.env.TEST_USER_PASS || 'TestPassword123!'}\n`;
  writeTestCredentialsFile(creds);

  await openLoginEntry(page);
  await page.locator('[data-testid="login-username"]').fill(username);
  await page.locator('[data-testid="login-password"]').fill(password);

  const privacyCheckbox = page.locator('[data-testid="login-privacy-accept"]');
  if (!(await privacyCheckbox.isChecked())) {
    await privacyCheckbox.check();
  }

  await submitCredentialsAndWaitForOtp(page);
  await page.locator('[data-testid="login-otp"]').fill(loadOtpCode());
  await page.locator('[data-testid="login-submit"]').click();

  await waitForAuthenticatedApp(page, username);
  expect(page.url()).not.toContain('/login');
});
