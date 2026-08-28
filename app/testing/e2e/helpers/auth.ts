// auth.ts
// Provides centralized authentication and credential-loading helpers for browser tests.
// Bridges protected credential files, Playwright pages, and repeated login workflows.
// Exists so tests share safe authentication behavior without duplicating secret handling.

import { expect, type Page } from '@playwright/test';
import * as path from 'path';
import {
  loadBrowserTestCredentials,
  resolveBrowserTestCredentialFilePath,
  resolveBrowserTestOtpCode,
  writeBrowserTestCredentialsFile,
} from '../../../server_tools/lib/browser_test_credentials.mjs';

const projectRoot = path.resolve(__dirname, '../../..');

export type TestCredentials = {
  username: string;
  password: string;
};

export type SessionInfo = {
  user_id?: number;
  username?: string;
};

/**
 * Resolves the protected browser-test credential file outside immutable app source.
 * Explicit process configuration keeps Easelect's established absolute root path intact.
 * Standalone Filterest defaults to its installation-owned keys/filterest_runtime scope.
 */
export function resolveTestCredentialFilePath(
  environment: Record<string, string | undefined> = process.env,
  applicationRoot = projectRoot,
): string {
  return resolveBrowserTestCredentialFilePath({ applicationRoot, environment });
}

/** Writes the reserved E2E identities without following a credential-file symlink. */
export function writeTestCredentialsFile(
  contents: string,
  environment: Record<string, string | undefined> = process.env,
  applicationRoot = projectRoot,
): string {
  return writeBrowserTestCredentialsFile({
    applicationRoot,
    contents,
    environment,
  });
}

/**
 * Validates that a session belongs to the exact non-guest test identity requested by the caller.
 * Bridges user-profile responses and E2E login reuse decisions.
 * Exists so a numeric user id cannot make a missing or swapped username look authenticated.
 */
export function sessionMatchesExpectedIdentity(
  sessionInfo: SessionInfo,
  expectedUsername: string,
): boolean {
  const normalizedExpectedUsername = expectedUsername.trim();
  return (
    typeof sessionInfo.user_id === 'number'
    && Number.isSafeInteger(sessionInfo.user_id)
    && sessionInfo.user_id > 1
    && normalizedExpectedUsername !== ''
    && sessionInfo.username === normalizedExpectedUsername
  );
}

export async function readSessionInfo(page: Page): Promise<SessionInfo> {
  // The browser-context request client shares the page's cookie jar but is not
  // destroyed when login/logout replaces the page's JavaScript execution context.
  // A successful SPA login can rotate the session cookie while its post-auth
  // bootstrap is still settling, so retry a short-lived 401 instead of reading
  // the superseded guest cookie as the final identity.
  const profileUrl = new URL('/api/user-profile', page.url()).toString();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await page.request.get(profileUrl);
    const contentType = response.headers()['content-type'] || '';
    if (response.ok() && contentType.includes('application/json')) {
      try {
        const sessionInfo = await response.json();
        if (sessionInfo && typeof sessionInfo === 'object') {
          return sessionInfo;
        }
      } catch {
        // Retry malformed transient responses during the same short window.
      }
    }
    if (attempt < 4) {
      await page.waitForTimeout(100);
    }
  }
  return {};
}

export function buildLoginEntryPath(redirectUrl = ''): string {
  const params = new URLSearchParams();
  params.set('login-entry', '1');
  if (redirectUrl) {
    params.set('redirect', redirectUrl);
  }
  return `/?${params.toString()}`;
}

/**
 * Opens the current guest-shell login entry point and waits until the login
 * modal form is visible. This mirrors the backend GET /login contract, which
 * now redirects into the SPA instead of rendering a standalone page.
 */
export async function openLoginEntry(
  page: Page,
  redirectUrl = '',
  baseUrl = ''
): Promise<void> {
  const targetPath = buildLoginEntryPath(redirectUrl);
  const targetUrl = baseUrl ? new URL(targetPath, baseUrl).toString() : targetPath;
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-testid="login-form"]')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('[data-testid="login-username"]')).toBeVisible({ timeout: 15000 });
}

/**
 * Submits the credential phase and waits for the OTP phase. The SPA login modal
 * can be visible a moment before its fragment submit listener is attached, so a
 * short retry keeps E2E setup from losing the first instant click.
 */
export async function submitCredentialsAndWaitForOtp(page: Page): Promise<void> {
  const submitButton = page.locator('[data-testid="login-submit"]');
  const otpSection = page.locator('[data-testid="login-otp-section"]');
  let lastError: unknown;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const responsePromise = page
      .waitForResponse(
        (response) =>
          response.url().endsWith('/api/login') &&
          response.request().method() === 'POST',
        { timeout: attempt === 1 ? 2500 : 10000 },
      )
      .catch(() => null);

    await submitButton.click();
    await responsePromise;

    try {
      await otpSection.waitFor({
        state: 'visible',
        timeout: attempt === 1 ? 2500 : 10000,
      });
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await page.waitForTimeout(250);
      }
    }
  }

  throw lastError;
}

/**
 * Waits until the app session is authenticated and the main shell tabs are
 * visible, which is the stable post-login signal for the guest-shell modal flow.
 */
export async function waitForAuthenticatedApp(
  page: Page,
  expectedUsername: string,
): Promise<void> {
  const normalizedExpectedUsername = expectedUsername.trim();
  if (!normalizedExpectedUsername) {
    throw new Error('waitForAuthenticatedApp requires a non-empty expected username.');
  }

  await page.waitForFunction(
    async (username) => {
      const response = await fetch('/api/user-profile', { credentials: 'include' });
      if (!response.ok) {
        return false;
      }
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        return false;
      }
      let data;
      try {
        data = await response.json();
      } catch {
        return false;
      }
      const userId = typeof data.user_id === 'number' ? data.user_id : 0;
      const sessionUsername = typeof data.username === 'string' ? data.username : '';
      return userId > 1 && username.length > 0 && sessionUsername === username;
    },
    normalizedExpectedUsername,
    { timeout: 15000 }
  );

  await page.waitForSelector('[data-testid^="tab-"]', { timeout: 15000 });
}

/**
 * Loads admin test credentials from the protected mutable credential scope.
 * File format: TEST_ADMIN_USER=... and TEST_ADMIN_PASS=... on separate lines.
 */
export function loadCredentials(): TestCredentials {
  return loadBrowserTestCredentials({ applicationRoot: projectRoot });
}

/**
 * Loads the explicit development OTP used by browser login flows.
 * Process configuration wins; ignored native runtime files are local fallbacks.
 * Missing configuration fails loudly instead of silently assuming a backend default.
 */
export function loadOtpCode({
  environment = process.env,
  devEnvFile,
  runtimeEnvFile,
}: {
  environment?: Record<string, string | undefined>;
  devEnvFile?: string;
  runtimeEnvFile?: string;
} = {}): string {
  return resolveBrowserTestOtpCode({
    applicationRoot: projectRoot,
    developmentEnvFile: devEnvFile,
    environment,
    runtimeEnvFile,
  });
}

/**
 * Logs into the application.
 *
 * With globalSetup + storageState, the browser context is pre-authenticated.
 * This function navigates to the app root. If already logged in (which is the
 * expected case), it simply waits for the app to load.
 *
 * If the session has expired and the login page appears, it performs a fresh
 * login (fallback for robustness).
 */
export async function login(page: Page, credentials?: TestCredentials): Promise<void> {
  const creds = credentials ?? loadCredentials();

  // Navigate to the app root
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  // Give the page a moment to stabilize (redirect or SPA load)
  await page.waitForTimeout(500);

  const sessionInfo = await readSessionInfo(page);

  // login_to_browse=false can leave us on "/" with a guest session (user_id=1),
  // so URL and user id alone are not strong enough authentication signals for tests.
  if (
    !page.url().includes('/login') &&
    sessionMatchesExpectedIdentity(sessionInfo, creds.username)
  ) {
    return;
  }

  // Fallback: session expired or storageState not available — login manually
  // Uses the 2-step AJAX login: Phase 1 (credentials) → Phase 2 (OTP)
  await openLoginEntry(page);

  await page.locator('[data-testid="login-username"]').fill(creds.username);
  await page.locator('[data-testid="login-password"]').fill(creds.password);

  const privacyCheckbox = page.locator('[data-testid="login-privacy-accept"]');
  if (!(await privacyCheckbox.isChecked())) {
    await privacyCheckbox.check();
  }

  // Phase 1: submit credentials → OTP section appears
  await submitCredentialsAndWaitForOtp(page);

  // Phase 2: use the same explicit OTP configuration as the native backend.
  await page.locator('[data-testid="login-otp"]').fill(loadOtpCode());
  await page.locator('[data-testid="login-submit"]').click();
  await waitForAuthenticatedApp(page, creds.username);

  const postLoginSessionInfo = await readSessionInfo(page);
  const postLoginUserId = typeof postLoginSessionInfo.user_id === 'number' ? postLoginSessionInfo.user_id : 0;
  const postLoginUsername = typeof postLoginSessionInfo.username === 'string' ? postLoginSessionInfo.username : '';

  expect(postLoginUserId, 'Expected login() to establish an authenticated non-guest session.').toBeGreaterThan(1);
  expect(postLoginUsername, 'Expected login() session username to match the requested test credentials.').toBe(creds.username);
}

/**
 * Logs out through the SPA tab and waits for the configured logged-out shell.
 *
 * Anonymous-browse instances rebuild the navbar, while login-required instances
 * follow the server-owned redirect to the standalone login form.
 */
export async function logout(page: Page): Promise<void> {
  const logoutSelector = '[data-testid="navbar-auth-logout"], [data-testid="tab-logout"]';
  await page.waitForSelector(logoutSelector, { timeout: 10000 });
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }),
    page.evaluate(() => {
      const logoutButton = document.querySelector(
        '[data-testid="navbar-auth-logout"], [data-testid="tab-logout"]',
      );
      if (!(logoutButton instanceof HTMLElement)) {
        throw new Error('Logout action not found for SPA logout helper.');
      }
      logoutButton.click();
    }),
  ]);
  await page.waitForFunction(async () => {
    const response = await fetch('/api/user-profile', { credentials: 'include' });
    return !response.ok;
  }, { timeout: 15000 });
  await page.waitForSelector('#navbar, [data-testid="login-form"]', {
    state: 'attached',
    timeout: 15000,
  });
}
