/**
 * auth.test.ts
 * Verifies E2E sign-in submission and strict session identity without a browser.
 * Bridges fake request/response events and the shared authentication helper.
 * Prevents duplicate submissions and preserves proven numeric account identity.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Page, Request, Response } from '@playwright/test';

import { loadOtpCode, sessionMatchesExpectedIdentity, submitCredentialsAndWaitForOtp, waitForAuthenticatedApp, authenticatedLoginResponseID } from './auth';

type FakeSubmission = {
  sent?: boolean;
  requestAfter?: number;
  responseAfter?: number | null;
  clickAfter?: number;
  ok?: boolean;
  unrelatedResponse?: boolean;
  result?: { otp_required: boolean };
};

function fakeSignInPage(submissions: FakeSubmission[]) {
  const requestListeners = new Set<(request: Request) => void>();
  const requestWaiters = new Set<(request: Request) => void>();
  const responseWaiters = new Set<(response: Response) => void>();
  const sentRequests: Request[] = [];
  let enabled = true;
  let visible = true;
  let physicalClicks = 0;
  function waitForEvent<T>(waiters: Set<(event: T) => void>, predicate: (event: T) => boolean, timeout: number) {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        waiters.delete(listener);
        reject(new Error('Event wait timed out'));
      }, timeout);
      const listener = (event: T) => {
        if (!predicate(event)) return;
        clearTimeout(timer);
        waiters.delete(listener);
        resolve(event);
      };
      waiters.add(listener);
    });
  }
  const click = vi.fn(async ({ timeout }: { timeout: number }) => {
    const deadline = Date.now() + timeout;
    while (!enabled || !visible) {
      if (Date.now() >= deadline) throw new Error('Click timed out waiting for the sign-in button');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const submission = submissions[physicalClicks++] ?? { sent: false };
    if (submission.clickAfter) await new Promise(resolve => setTimeout(resolve, submission.clickAfter));
    if (submission.sent === false) return;
    // The real form disables synchronously, then awaits its fingerprint before POST.
    enabled = false;
    const sendRequest = () => {
      const request = { url: () => 'https://example.invalid/api/login', method: () => 'POST' } as Request;
      sentRequests.push(request);
      for (const listener of requestListeners) listener(request);
      for (const listener of requestWaiters) listener(request);
      const response = {
        url: request.url,
        request: () => request,
        ok: () => submission.ok !== false,
        json: async () => submission.result ?? { authenticated: true, user_id: 42 },
      } as Response;
      if (submission.unrelatedResponse) {
        // An unrelated login response must never prove this submission's identity.
        for (const listener of responseWaiters) listener({ ...response, request: () => ({ ...request }) } as Response);
      }
      if (submission.responseAfter === null) return;
      setTimeout(() => {
        enabled = true;
        visible = submission.ok === false || submission.result?.otp_required === true;
        for (const listener of responseWaiters) listener(response);
      }, submission.responseAfter ?? 0);
    };
    if (submission.requestAfter) setTimeout(sendRequest, submission.requestAfter);
    else sendRequest();
  });
  const waitForOtp = vi.fn();
  const page = {
    locator: (selector: string) => selector.includes('otp-section') ? { waitFor: waitForOtp } : {
      click, isEnabled: vi.fn(async () => enabled),
    },
    on: vi.fn((_event: string, listener: (request: Request) => void) => { requestListeners.add(listener); }),
    off: vi.fn((_event: string, listener: (request: Request) => void) => { requestListeners.delete(listener); }),
    waitForRequest: vi.fn((predicate: (request: Request) => boolean, options: { timeout: number }) =>
      waitForEvent(requestWaiters, predicate, options.timeout)),
    waitForResponse: vi.fn((predicate: (response: Response) => boolean, options: { timeout: number }) =>
      waitForEvent(responseWaiters, predicate, options.timeout)),
    waitForTimeout: vi.fn((timeout: number) => new Promise(resolve => setTimeout(resolve, timeout))),
  };
  return { page: page as unknown as Page, click, waitForOtp, sentRequests };
}

describe('sign-in submission retries', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  it('returns a response arriving after the short request window with exactly one click', async () => {
    const { page, click } = fakeSignInPage([{ responseAfter: 4000 }]);
    const result = submitCredentialsAndWaitForOtp(page);
    await vi.advanceTimersByTimeAsync(3000);
    expect(click).toHaveBeenCalledExactlyOnceWith({ timeout: 10000 });
    await vi.advanceTimersByTimeAsync(1000);
    await expect(result).resolves.toBe(false);
    expect(click).toHaveBeenCalledTimes(1);
    expect(page.waitForRequest).toHaveBeenCalledWith(expect.any(Function), { timeout: 2500 });
    expect(page.waitForResponse).toHaveBeenCalledWith(expect.any(Function), { timeout: 20000 });
    expect(page.off).toHaveBeenCalledWith('request', expect.any(Function));
  });

  it('clicks again only when the first window sent no request', async () => {
    const { page, click } = fakeSignInPage([{ sent: false }, { responseAfter: 100 }]);
    const result = submitCredentialsAndWaitForOtp(page);
    await vi.advanceTimersByTimeAsync(2499);
    expect(click).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(101);
    await expect(result).resolves.toBe(false);
    expect(click.mock.calls).toEqual([[{ timeout: 10000 }], [{ timeout: 10000 }]]);
    expect(page.waitForRequest).toHaveBeenNthCalledWith(2, expect.any(Function), { timeout: 10000 });
  });

  it('reports a sent request without a response and never clicks again', async () => {
    const { page, click } = fakeSignInPage([{ responseAfter: null, unrelatedResponse: true }]);
    const result = expect(submitCredentialsAndWaitForOtp(page)).rejects.toThrow('Sign-in submission returned no response.');
    await vi.advanceTimersByTimeAsync(20000);
    await result;
    expect(click).toHaveBeenCalledTimes(1);
    expect(page.off).toHaveBeenCalledWith('request', expect.any(Function));
  });

  it('keeps a request sent after the short window during click auto-wait', async () => {
    const { page, click } = fakeSignInPage([{ clickAfter: 3000, responseAfter: 1000 }]);
    const result = submitCredentialsAndWaitForOtp(page);
    await vi.advanceTimersByTimeAsync(4000);
    await expect(result).resolves.toBe(false);
    expect(click).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])('handles a POST delayed beyond click completion on success (OTP=%s)', async otpRequired => {
    const { page, click, waitForOtp, sentRequests } = fakeSignInPage([
      { requestAfter: 3000, responseAfter: 1000, ...(otpRequired ? { result: { otp_required: true } } : {}) },
      { responseAfter: null },
    ]);
    const outcome = submitCredentialsAndWaitForOtp(page).then(otp => ({ otp }), error => ({ error: error.message }));
    await click.mock.results[0].value; // Click already resolved; the POST is still pending.
    expect(sentRequests).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(4000);
    // Flush any already-queued click even if sign-in itself has finished.
    await vi.advanceTimersByTimeAsync(20000);
    const actual = await outcome;
    expect(sentRequests).toHaveLength(1);
    expect(actual).toEqual({ otp: otpRequired });
    expect(click).toHaveBeenCalledTimes(1);
    expect(waitForOtp).toHaveBeenCalledTimes(otpRequired ? 1 : 0);
  });

  it('handles a POST delayed beyond click completion on refusal without a second submission', async () => {
    const { page, click, sentRequests } = fakeSignInPage([
      { requestAfter: 3000, responseAfter: 1000, ok: false },
      { responseAfter: null },
    ]);
    const outcome = submitCredentialsAndWaitForOtp(page).then(otp => ({ otp }), error => ({ error: error.message }));
    await click.mock.results[0].value;
    expect(sentRequests).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(24000);
    const actual = await outcome;
    expect(sentRequests).toHaveLength(1);
    expect(actual).toEqual({ error: 'Sign-in submission was refused.' });
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('handles a POST delayed beyond click completion with no response and no second submission', async () => {
    const { page, click, sentRequests } = fakeSignInPage([{ requestAfter: 3000, responseAfter: null }]);
    const outcome = submitCredentialsAndWaitForOtp(page).then(otp => ({ otp }), error => ({ error: error.message }));
    await click.mock.results[0].value;
    expect(sentRequests).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(24000);
    const actual = await outcome;
    expect(sentRequests).toHaveLength(1);
    expect(actual).toEqual({ error: 'Sign-in submission returned no response.' });
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('uses the same single-submission rule when the shared button reaches OTP', async () => {
    const { page, click, waitForOtp } = fakeSignInPage([
      { responseAfter: 4000, result: { otp_required: true } },
      { responseAfter: 4000 },
    ]);
    const first = submitCredentialsAndWaitForOtp(page);
    await vi.advanceTimersByTimeAsync(4000);
    await expect(first).resolves.toBe(true);
    expect(waitForOtp).toHaveBeenCalledExactlyOnceWith({ state: 'visible', timeout: 10000 });
    const second = submitCredentialsAndWaitForOtp(page);
    await vi.advanceTimersByTimeAsync(4000);
    await expect(second).resolves.toBe(false);
    expect(click).toHaveBeenCalledTimes(2);
  });
});

describe('fresh sign-in identity proof', () => {
  it('requires a successful response with a valid numeric id', () => {
    expect(authenticatedLoginResponseID({ authenticated: true, user_id: 42 })).toBe(42);
    for (const data of [{ authenticated: false, user_id: 42 }, { authenticated: true }, { authenticated: true, user_id: 1 }]) {
      expect(() => authenticatedLoginResponseID(data)).toThrow();
    }
  });
  it('rejects an existing session after refused credentials, and requires the submitted account', async () => {
    const page = {
      locator: () => ({ click: vi.fn(), waitFor: vi.fn() }),
      on: vi.fn(), off: vi.fn(),
      waitForRequest: vi.fn().mockResolvedValue({}),
      waitForResponse: vi.fn().mockResolvedValue({ ok: () => false, json: async () => ({}) }),
      waitForFunction: vi.fn(),
    } as unknown as Page;
    await expect(submitCredentialsAndWaitForOtp(page)).rejects.toThrow('refused');
    await expect(waitForAuthenticatedApp(page)).rejects.toThrow('expected account');
    expect(page.waitForFunction).not.toHaveBeenCalled();
    vi.mocked(page.waitForResponse).mockResolvedValue({ ok: () => true, json: async () => ({ authenticated: true, user_id: 42 }) } as never);
    await expect(submitCredentialsAndWaitForOtp(page)).resolves.toBe(false);
    await expect(waitForAuthenticatedApp(page, 99)).rejects.toThrow('expected account');
    expect(page.waitForFunction).not.toHaveBeenCalled();
  });
  it('cannot record another signed-in account when no identity was remembered', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: true, headers: { get: () => 'application/json' }, json: async () => ({ user_id: 99 }) }));
    try {
      const page = {
        locator: () => ({ click: async () => {} }),
        on: vi.fn(), off: vi.fn(),
        waitForRequest: async () => ({}),
        waitForResponse: async () => ({ ok: () => true, json: async () => ({ authenticated: true, user_id: 42 }) }),
        waitForFunction: async (fn: (id?: number) => Promise<boolean>, id?: number) => {
          if (!await fn(id)) throw new Error('Session belongs to another account.');
        },
        waitForSelector: async () => {},
        url: () => 'https://example.invalid/',
        request: { get: async () => ({ ok: () => true, headers: () => ({ 'content-type': 'application/json' }), json: async () => ({ user_id: 99 }) }) },
      } as unknown as Page;
      await submitCredentialsAndWaitForOtp(page);
      await expect(waitForAuthenticatedApp(page)).rejects.toThrow('another account');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('sessionMatchesExpectedIdentity', () => {
  it('keeps the verified account identity across display-name changes', () => {
    expect(sessionMatchesExpectedIdentity({ user_id: 4, username: 'admin_17' }, 4)).toBe(true);
    expect(sessionMatchesExpectedIdentity({ user_id: 4, username: 'renamed' }, 4)).toBe(true);
    expect(sessionMatchesExpectedIdentity({ user_id: 4 }, 4)).toBe(true);
  });
  it.each([[{ user_id: 5, username: 'admin_17' }, 4], [{ user_id: 1 }, 1], [{ user_id: 4 }, 0], [{ user_id: 4.5 }, 4.5]])('rejects another or invalid id %#', (sessionInfo, expectedID) => {
    expect(sessionMatchesExpectedIdentity(sessionInfo, expectedID)).toBe(false);
  });
});

describe('loadOtpCode', () => {
  it('prefers the explicit process configuration', () => {
    expect(loadOtpCode({
      environment: { LOGIN_OTP_CODE: '654321' },
      devEnvFile: '/missing/dev_env.txt',
    })).toBe('654321');
  });

  it('reads the ignored native dev environment as the local fallback', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'easelect-e2e-otp-'));
    const devEnvFile = path.join(tempDir, 'dev_env.txt');
    fs.writeFileSync(devEnvFile, 'DB_PORT=5433\nLOGIN_OTP_CODE=123456\n', 'utf8');
    try {
      expect(loadOtpCode({ environment: {}, devEnvFile })).toBe('123456');
    } finally {
      fs.rmSync(tempDir, { force: true, recursive: true });
    }
  });

  it('reads a configured external key home without root compatibility files', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'easelect-e2e-key-root-'));
    const keyRoot = path.join(tempDir, 'filterest_keys');
    for (const profileName of ['easelect_development', 'filterest_runtime']) {
      const developmentRoot = path.join(keyRoot, profileName);
      fs.mkdirSync(developmentRoot, { recursive: true });
      fs.writeFileSync(
        path.join(developmentRoot, 'development_environment.env'),
        'LOGIN_OTP_CODE=345678\n',
        'utf8',
      );
    }
    try {
      expect(loadOtpCode({
        environment: { FILTEREST_KEYS_HOME: keyRoot },
      })).toBe('345678');
    } finally {
      fs.rmSync(tempDir, { force: true, recursive: true });
    }
  });

  it('reads the ignored runtime .env after an empty native dev environment', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'easelect-e2e-runtime-otp-'));
    const devEnvFile = path.join(tempDir, 'dev_env.txt');
    const runtimeEnvFile = path.join(tempDir, '.env');
    fs.writeFileSync(devEnvFile, 'DB_PORT=5433\n', 'utf8');
    fs.writeFileSync(runtimeEnvFile, 'LOGIN_OTP_CODE=234567\n', 'utf8');
    try {
      expect(loadOtpCode({
        environment: {},
        devEnvFile,
        runtimeEnvFile,
      })).toBe('234567');
    } finally {
      fs.rmSync(tempDir, { force: true, recursive: true });
    }
  });

  it('fails clearly when no OTP is configured', () => {
    expect(() => loadOtpCode({
      environment: {},
      devEnvFile: '/missing/dev_env.txt',
    })).toThrow('Missing LOGIN_OTP_CODE');
  });
});
