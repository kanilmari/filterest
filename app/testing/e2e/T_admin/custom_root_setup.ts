// custom_root_setup.ts
// Creates an isolated administrator session for the manual K378 proof.
// Connects the existing credential/login helpers to a dataset return address.
// Avoids a custom root intercepting login completion; cleans files even after setup failure.
import { chromium, type FullConfig } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadCredentials, loadOtpCode, openLoginEntry, submitCredentialsAndWaitForOtp, waitForAuthenticatedApp } from '../helpers/auth';
import { writeOwnerOnlyJsonFile, ensureOwnerOnlyStorageStateDirectory } from '../helpers/storage-state-file';

export default async function setup(config: FullConfig) {
  const fixture = process.env.FILTEREST_E2E_CUSTOM_ROOT_FIXTURE!;
  const helper = path.join(__dirname, 'T18_custom_root_fixture.sh');
  const state = config.projects[0].use.storageState as string;
  const cleanup = () => {
    try { execFileSync('bash', [helper, 'remove', fixture], { stdio: 'pipe' }); }
    finally { fs.rmSync(state, { force: true }); }
  };
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    execFileSync('bash', [helper, 'verify', fixture], { stdio: 'pipe' });
    browser = await chromium.launch();
    const context = await browser.newContext({
      baseURL: config.projects[0].use.baseURL, ignoreHTTPSErrors: true,
      extraHTTPHeaders: { 'X-Bypass-Ratelimit': 'test-mode' },
    });
    const page = await context.newPage();
    const credentials = loadCredentials();
    await openLoginEntry(page, '/system_config');
    await page.getByTestId('login-username').fill(credentials.username);
    await page.getByTestId('login-password').fill(credentials.password);
    await page.getByTestId('login-privacy-accept').check();
    if (await submitCredentialsAndWaitForOtp(page)) {
      await page.getByTestId('login-otp').fill(loadOtpCode());
      await submitCredentialsAndWaitForOtp(page);
    }
    await waitForAuthenticatedApp(page);
    const admin = await context.request.get('/api/admin/front-page');
    if (!admin.ok()) throw new Error('K378 requires an administrator account.');
    ensureOwnerOnlyStorageStateDirectory(path.dirname(state));
    writeOwnerOnlyJsonFile(state, await context.storageState());
    await browser.close();
    browser = undefined;
    return cleanup;
  } catch (error) {
    const failures = [error];
    try { await browser?.close(); } catch (closeError) { failures.push(closeError); }
    try { cleanup(); } catch (cleanupError) { failures.push(cleanupError); }
    throw new AggregateError(failures, 'K378 setup failed; cleanup attempted.');
  }
}
