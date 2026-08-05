/**
 * global-setup.ts — Runs once before all tests.
 *
 * Logs in with the test admin user and saves the authenticated session
 * (cookies, localStorage) to .auth/user.json. All test projects then
 * re-use that session via storageState so login only happens once.
 *
 * This avoids hitting the server's per-IP rate limit (10 attempts / 15 min).
 */

import { chromium, type Browser, type FullConfig } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import {
  loadCredentials,
  loadOtpCode,
  openLoginEntry,
  readSessionInfo,
  submitCredentialsAndWaitForOtp,
  waitForAuthenticatedApp,
} from './helpers/auth';
import {
  readSyntheticArtifactBaselineWithStorageState,
} from './helpers/test-artifact-cleanup';
import {
  finishArtifactRunRegistry,
  initializeArtifactRunRegistry,
} from './helpers/test-artifact-run-registry';
import {
  ensureOwnerOnlyStorageStateDirectory,
  removeStorageStateFile,
  writeOwnerOnlyJsonFile,
} from './helpers/storage-state-file';
import { hydrateAuthenticatedTreeDataCache } from './helpers/tree-data-cache';

const AUTH_FILE = path.join(__dirname, '.auth', 'user.json');
const ARTIFACT_BASELINE_FILE = path.join(__dirname, '.auth', 'artifact-baseline.json');

async function globalSetup(_config: FullConfig) {
  const baseURL =
    _config.projects[0]?.use?.baseURL && typeof _config.projects[0].use.baseURL === 'string'
      ? _config.projects[0].use.baseURL
      : 'https://localhost:8082';

  // Restrict the shared auth root before the registry or session state touches it.
  const authDir = path.dirname(AUTH_FILE);
  ensureOwnerOnlyStorageStateDirectory(authDir);

  // Load test credentials
  const { username, password } = loadCredentials();
  const otpCode = loadOtpCode();

  if (!username || !password) {
    throw new Error(
      'Missing TEST_ADMIN_USER or TEST_ADMIN_PASS in dev_env_test_creds.txt.'
    );
  }

  // The exclusive registry lock must exist before shared auth/baseline files
  // are touched. Active, stale, and corrupt foreign runs fail closed here.
  const artifactRun = initializeArtifactRunRegistry();
  removeStorageStateFile(AUTH_FILE);
  fs.rmSync(ARTIFACT_BASELINE_FILE, { force: true });

  let browser: Browser | null = null;
  try {
    browser = await chromium.launch();
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      extraHTTPHeaders: {
        'X-Bypass-Ratelimit': 'test-mode',
      },
    });
    const page = await context.newPage();

    // Open the SPA guest-shell login entry instead of the legacy standalone /login page.
    await openLoginEntry(page, '', baseURL);

    // 2-step AJAX login: Phase 1 (credentials) → Phase 2 (OTP)
    await page.locator('[data-testid="login-username"]').fill(username);
    await page.locator('[data-testid="login-password"]').fill(password);

    const privacy = page.locator('[data-testid="login-privacy-accept"]');
    if (!(await privacy.isChecked())) {
      await privacy.check();
    }

    await submitCredentialsAndWaitForOtp(page);
    await page.locator('[data-testid="login-otp"]').fill(otpCode);
    await page.locator('[data-testid="login-submit"]').click();
    await waitForAuthenticatedApp(page, username);
    const sessionIdentity = await readSessionInfo(page);
    if (
      typeof sessionIdentity.user_id !== 'number' ||
      !Number.isSafeInteger(sessionIdentity.user_id) ||
      sessionIdentity.user_id <= 1 ||
      sessionIdentity.username !== username
    ) {
      throw new Error(
        `Authenticated E2E identity mismatch during setup: expected ${username}, ` +
        `got ${sessionIdentity.username ?? 'missing'} (${sessionIdentity.user_id ?? 'missing'}).`,
      );
    }

    writeOwnerOnlyJsonFile(AUTH_FILE, await context.storageState());
    await hydrateAuthenticatedTreeDataCache(page);
    writeOwnerOnlyJsonFile(AUTH_FILE, await context.storageState());

    // Capture every pre-existing dataset, folder id/name pair, and lang key.
    // Setup never deletes stale-looking names.
    const artifactBaseline = await readSyntheticArtifactBaselineWithStorageState(
      baseURL,
      AUTH_FILE,
      {
        runId: artifactRun.runId,
        baseURL,
        userId: sessionIdentity.user_id!,
        username,
      },
    );
    writeOwnerOnlyJsonFile(ARTIFACT_BASELINE_FILE, artifactBaseline);
  } catch (error) {
    removeStorageStateFile(AUTH_FILE);
    fs.rmSync(ARTIFACT_BASELINE_FILE, { force: true });
    try {
      finishArtifactRunRegistry(artifactRun.runId);
    } catch (registryError) {
      throw new AggregateError(
        [error, registryError],
        'E2E global setup failed and its empty artifact run could not be released.',
      );
    }
    throw error;
  } finally {
    await browser?.close();
  }
}

export default globalSetup;
