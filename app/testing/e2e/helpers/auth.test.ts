/**
 * auth.test.ts
 * Verifies strict E2E session identity matching without launching a browser.
 * Bridges user-profile response shapes and the shared authentication helper.
 * Exists so display-name changes cannot invalidate a proven numeric account identity.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { describe, expect, it, vi } from 'vitest';
import type { Page } from '@playwright/test';

import { loadOtpCode, sessionMatchesExpectedIdentity, submitCredentialsAndWaitForOtp, waitForAuthenticatedApp, authenticatedLoginResponseID } from './auth';

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
