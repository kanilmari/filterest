// L8_login_name_canary.spec.ts
// Proves LT10 browser response and storage channels with disposable random account names.
// Bridges protected fixture identities, two browser sessions and the real Account profile.
// Exists to complement Go's raw-cookie, mail, application-log and database canary checks.
import { test, expect, type Page, type Response, type APIResponse, type BrowserContext } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { openLoginEntry, submitCredentialsAndWaitForOtp, waitForAuthenticatedApp, logout } from '../helpers/auth';
import { fetchCsrfTokenForRequest } from '../helpers/temp-dataset';

type CanaryAccount = { role: 'admin' | 'user'; user_id: number; username: string; display_name: string; password: string };

function loadCanaryAccounts(): CanaryAccount[] {
  const file = process.env.FILTEREST_E2E_CANARY_ACCOUNTS_FILE || '';
  if (!isAbsolute(file)) throw new Error('Canary fixture file must be an absolute protected path.');
  const stat = lstatSync(file);
  if (!stat.isFile() || (stat.mode & 0o077) !== 0) throw new Error('Canary fixture file must be a regular owner-only file (0600).');
  const accounts = JSON.parse(readFileSync(file, 'utf8')) as CanaryAccount[];
  if (!Array.isArray(accounts) || accounts.length !== 2 || new Set(accounts.map(account => account.role)).size !== 2
    || !accounts.some(account => account.role === 'admin') || !accounts.some(account => account.role === 'user')
    || new Set(accounts.map(account => account.user_id)).size !== 2
    || new Set(accounts.map(account => account.username)).size !== 2
    || accounts.some(account => !Number.isSafeInteger(account.user_id) || account.user_id <= 1
      || !/^wl132_[a-f0-9]{32}$/.test(account.username) || typeof account.display_name !== 'string'
      || account.display_name.toLowerCase() === account.username || typeof account.password !== 'string' || account.password.length < 12)) {
    throw new Error('Canary fixtures require distinct random admin/user login names, ids, public names and passwords.');
  }
  return accounts;
}

async function signIn(page: Page, account: CanaryAccount) {
  await openLoginEntry(page);
  await page.getByTestId('login-username').fill(account.username);
  await page.getByTestId('login-password').fill(account.password);
  await page.getByTestId('login-privacy-accept').check();
  expect(await submitCredentialsAndWaitForOtp(page), 'Canary fixtures must use password-only sign-in.').toBe(false);
  await waitForAuthenticatedApp(page, account.user_id);
}

async function confirmProfileAction(page: Page, password: string) {
  await page.getByTestId('input-modal-input').fill(password);
  const response = page.waitForResponse(response => response.url().includes('/api/update-profile') && response.request().method() === 'POST');
  await page.getByTestId('input-modal-confirm-button').click();
  expect((await response).status()).toBe(200);
}

test('LT10 — random private names stay out of browser responses and other-device sessions', async ({ browser, request, baseURL }, info) => {
  test.skip(process.env.FILTEREST_E2E_LOGIN_NAME_CANARY !== '1', 'Requires explicitly disposable native account fixtures.');
  test.skip(info.project.name !== 'desktop-card', 'Account mutation proof runs once, outside concurrent matrix variants.');
  test.setTimeout(120_000);
  const origin = new URL(baseURL!).origin;
  expect(['localhost', '127.0.0.1', '[::1]']).toContain(new URL(origin).hostname);
  const accounts = loadCanaryAccounts();
  const names = accounts.map(account => account.username);
  const findings: string[] = [];
  const pending: Promise<void>[] = [];
  let responseCount = 0;
  const inspect = (text: string, channel: string) => {
    if (names.some(name => text.toLowerCase().includes(name))) findings.push(channel);
  };
  const inspectAPI = async (response: APIResponse) => {
    inspect(response.url(), 'API response URL');
    inspect(JSON.stringify(response.headersArray()), 'API response headers');
    inspect(await response.text(), 'API response body');
    return response;
  };
  const profile = async (context: BrowserContext) => inspectAPI(await context.request.get('/api/user-profile'));
  const capture = async (response: Response) => {
    responseCount += 1;
    // A request URL the test sends is its own input (the search below carries the canary name on purpose); only a
    // redirect destination is chosen by the server. Headers include any Location the server sets.
    if (response.request().redirectedFrom()) inspect(response.url(), 'redirect destination');
    inspect(JSON.stringify(await response.headersArray()), 'response headers');
    if (/text\/html|application\/json/.test(response.headers()['content-type'] || '') && response.status() < 300) {
      try { inspect(await response.text(), 'response body'); }
      catch { findings.push('response body could not be inspected'); }
    }
  };
  const supervisorList = await inspectAPI(await request.get('/api/admin/user-authentication'));
  expect(supervisorList.status()).toBe(200);
  inspect(await supervisorList.text(), 'administrator account list');
  const { users } = await supervisorList.json();
  const supervisorProfile = await inspectAPI(await request.get('/api/user-profile'));
  const supervisorID = (await supervisorProfile.json()).user_id;
  for (const account of accounts) {
    expect(account.user_id).not.toBe(supervisorID);
    const record = users.find((user: { user_id: number }) => user.user_id === account.user_id);
    expect(record?.enabled).toBe(true);
    expect(record?.admin_group_member || record?.admin_access_allowed).toBe(account.role === 'admin');
    const options = { baseURL, ignoreHTTPSErrors: true, storageState: { cookies: [], origins: [] },
      extraHTTPHeaders: { 'X-Bypass-Ratelimit': 'test-mode' } };
    const current = await browser.newContext(options);
    const other = await browser.newContext(options);
    for (const context of [current, other]) context.on('response', response => { pending.push(capture(response)); });
    const page = await current.newPage();
    const otherPage = await other.newPage();
    let renameAttempted = false;
    try {
      await signIn(page, account);
      await signIn(otherPage, account);
      await page.evaluate(() => {
        const button = document.querySelector('[data-testid="tab-user"]');
        if (!(button instanceof HTMLElement)) throw new Error('Account profile navigation missing.');
        button.click();
      });
      await expect(page.locator('#edit_username')).toHaveValue(account.display_name);
      await expect(page.locator('#new_login_name')).toHaveValue('');
      inspect(await page.content(), 'authenticated DOM');
      await page.locator('#sign_out_other_devices').click();
      await confirmProfileAction(page, account.password);
      expect((await profile(current)).status()).toBe(200);
      expect((await profile(other)).status()).toBe(401);
      // Use the actual profile control for both actions; a second browser's
      // old cookie must fail again after a successful name change.
      await otherPage.goto('about:blank');
      await signIn(otherPage, account);
      const replacement = `wl132_${randomBytes(16).toString('hex')}`;
      names.push(replacement);
      await page.locator('#new_login_name').fill(replacement);
      // The change can commit even when its confirmation or response fails, so restore whenever it was submitted.
      renameAttempted = true;
      await page.locator('#profile_security_form button[type="submit"]').click();
      await confirmProfileAction(page, account.password);
      await expect(page.locator('#new_login_name')).toHaveValue('');
      expect((await profile(current)).status()).toBe(200);
      expect((await profile(other)).status()).toBe(401);
      inspect(await page.content(), 'profile DOM after change');
      for (const name of names) {
        const answer = await page.evaluate(async name => {
          const response = await fetch(`/api/get-results?dataset=system_users&search=${encodeURIComponent(name)}`);
          return { status: response.status, body: await response.json() };
        }, name);
        expect(answer.status).toBe(200);
        expect(answer.body.data).toEqual([]);
      }
      inspect(JSON.stringify(await current.storageState()), 'browser cookies / local storage');
      await logout(page);
      expect((await profile(current)).status()).toBe(401);
      await signIn(page, { ...account, username: replacement });
      inspect(await page.content(), 'fresh sign-in DOM');
      await page.goto('about:blank');
      await otherPage.goto('about:blank');
      await Promise.all(pending);
    } finally {
      // The supervising fixture administrator restores only the supplied id, before the browsers close, so a
      // failing close cannot skip it. Never rename shared E2E credentials or infer an account id from a name.
      try {
        if (renameAttempted) {
          const csrf = await fetchCsrfTokenForRequest(request);
          const restored = await inspectAPI(await request.post('/api/admin/user-login-name', {
            headers: { 'X-CSRF-Token': csrf }, data: { user_id: account.user_id, login_name: account.username },
          }));
          inspect(await restored.text(), 'administrator restore reply');
          expect(restored.status(), 'Restore disposable account login name.').toBe(200);
        }
      } finally {
        await current.close().catch(() => undefined);
        await other.close().catch(() => undefined);
      }
    }
  }
  expect(responseCount, 'Canary response listener positive control.').toBeGreaterThan(0);
  expect(findings, 'Private-name hits in browser channels.').toEqual([]);
});
