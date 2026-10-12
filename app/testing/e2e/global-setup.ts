// global-setup.ts
// Creates one authenticated browser session before the end-to-end test suite.
// Bridges protected test credentials, login, and installation-owned Playwright state.
// Exists so all browser projects reuse a deterministic session without exposing secrets.
/**
 * Successful logins no longer consume the server's
 * failed-login limit (10 rejected credentials or factors / 15 min).
 */

import { clearVerifiedTestIdentities, writeVerifiedTestIdentity, initializeTestIdentityKey } from './helpers/auth_identity';
import { chromium, type Browser, type FullConfig, type Page, type BrowserContext } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import {
  loadCredentials,
  loadOtpCode,
  openLoginEntry,
  readSessionInfo,
  submitCredentialsAndWaitForOtp,
  waitForAuthenticatedApp,
  type SessionInfo,
} from './helpers/auth';
import {
  readSyntheticArtifactBaselineWithStorageState,
} from './helpers/test-artifact-cleanup';
import {
  finishArtifactRunRegistry,
  type CurrentArtifactRun,
} from './helpers/test-artifact-run-registry';
import {
  initializeArtifactRunRegistryWithRecovery,
  recoverStaleRunDatasets,
} from './helpers/test-artifact-stale-run-recovery';
import {
  ensureOwnerOnlyStorageStateDirectory,
  removeStorageStateFile,
  writeOwnerOnlyJsonFile,
} from './helpers/storage-state-file';
import { hydrateAuthenticatedTreeDataCache } from './helpers/tree-data-cache';
import { resolveFilterestTestRuntimePaths } from './helpers/test-runtime-paths';
import { resolveLocalFilterestBaseUrl } from '../../server_tools/scripts/local_filterest_target.cjs';
import { readArtifactRunTarget } from './helpers/test-artifact-run-target';
import { safeTestArtifactFailure } from './helpers/test-artifact-diagnostics';

const testRuntimePaths = resolveFilterestTestRuntimePaths();
const AUTH_FILE = testRuntimePaths.authStorageState;
const ARTIFACT_BASELINE_FILE = path.join(
  testRuntimePaths.authDirectory,
  'artifact-baseline.json',
);

async function globalSetup(_config: FullConfig) {
  const baseURL =
    _config.projects[0]?.use?.baseURL && typeof _config.projects[0].use.baseURL === 'string'
      ? _config.projects[0].use.baseURL
      : resolveLocalFilterestBaseUrl({ applicationRoot: path.resolve(__dirname, '../..') });

  // Restrict the shared auth root before the registry or session state touches it.
  const authDir = path.dirname(AUTH_FILE);
  ensureOwnerOnlyStorageStateDirectory(authDir);

  // Load test credentials
  const { username, password } = loadCredentials();

  if (!username || !password) {
    throw new Error(
      'Missing TEST_ADMIN_USER or TEST_ADMIN_PASS in the configured test credential file.'
    );
  }

  let artifactRun: CurrentArtifactRun | null = null;
  let closeFailure: Error | null = null;
  const browserLifetime: { browser: Browser | null } = { browser: null };
  let authenticated: { page: Page; context: BrowserContext; sessionIdentity: SessionInfo; verifiedUserID: number } | null = null;
  const authenticate = async () => {
    if (authenticated) return authenticated;
    const browser = await chromium.launch();
    browserLifetime.browser = browser;
    const context = await browser.newContext({
      baseURL,
      ignoreHTTPSErrors: true,
      extraHTTPHeaders: {
        'X-Bypass-Ratelimit': 'test-mode',
      },
    });
    const page = await context.newPage();

    // Open the SPA guest-shell login entry instead of the legacy standalone /login page.
    await openLoginEntry(page, '', baseURL);

    // Submit credentials first. Accounts with an explicit verification factor
    // continue to the OTP phase; protected automation accounts finish here.
    await page.locator('[data-testid="login-username"]').fill(username);
    await page.locator('[data-testid="login-password"]').fill(password);

    const privacy = page.locator('[data-testid="login-privacy-accept"]');
    if (!(await privacy.isChecked())) {
      await privacy.check();
    }

    const otpRequired = await submitCredentialsAndWaitForOtp(page);
    if (otpRequired) {
      await page.locator('[data-testid="login-otp"]').fill(loadOtpCode());
      await submitCredentialsAndWaitForOtp(page);
    }
    const verifiedUserID = await waitForAuthenticatedApp(page);
    const sessionIdentity = await readSessionInfo(page);
    if (
      typeof sessionIdentity.user_id !== 'number' ||
      !Number.isSafeInteger(sessionIdentity.user_id) ||
      sessionIdentity.user_id <= 1 ||
      sessionIdentity.user_id !== verifiedUserID
    ) {
      throw new Error(
        `Authenticated E2E identity mismatch during setup: expected id ${verifiedUserID}, got ${sessionIdentity.user_id ?? 'missing'}.`,
      );
    }

    authenticated = { page, context, sessionIdentity, verifiedUserID };
    return authenticated;
  };

  try {
    // Hold startup ownership across dead-run inspection and fresh login. Shared
    // auth/baseline files remain intact until recovery publishes the new run.
    artifactRun = await initializeArtifactRunRegistryWithRecovery({}, async (run, artifacts, assertStillDead) => {
      const { context, sessionIdentity, verifiedUserID } = await authenticate();
      await recoverStaleRunDatasets(context.request, {
        userId: verifiedUserID,
        username: sessionIdentity.username || String(verifiedUserID),
        baseURL,
      }, run, artifacts, assertStillDead);
    }, async () => readArtifactRunTarget((await authenticate()).context.request, baseURL));
    initializeTestIdentityKey();
    removeStorageStateFile(AUTH_FILE);
    fs.rmSync(ARTIFACT_BASELINE_FILE, { force: true });
    clearVerifiedTestIdentities();
    const { context, page, sessionIdentity, verifiedUserID } = await authenticate();

    writeVerifiedTestIdentity({ username, password }, baseURL, verifiedUserID);
    writeOwnerOnlyJsonFile(AUTH_FILE, await context.storageState());
    await hydrateAuthenticatedTreeDataCache(page);
    writeOwnerOnlyJsonFile(AUTH_FILE, await context.storageState());

    // Capture every pre-existing dataset, folder id/name pair, and lang key.
    // Recovery has finished; baseline reads never infer ownership from names.
    const artifactBaseline = await readSyntheticArtifactBaselineWithStorageState(
      baseURL,
      AUTH_FILE,
      {
        runId: artifactRun.runId,
        baseURL,
        userId: sessionIdentity.user_id!,
        username: sessionIdentity.username || String(verifiedUserID),
      },
    );
    writeOwnerOnlyJsonFile(ARTIFACT_BASELINE_FILE, artifactBaseline);
  } catch (error) {
    if (!artifactRun) throw error;
    clearVerifiedTestIdentities();
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
    try {
      await browserLifetime.browser?.close();
    } catch (error) {
      closeFailure = safeTestArtifactFailure(error, 'close E2E setup browser');
    }
  }
  // A secondary close failure must not replace the original recovery refusal.
  if (closeFailure) throw closeFailure;
}

export default globalSetup;
