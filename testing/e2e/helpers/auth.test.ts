/**
 * auth.test.ts
 * Verifies strict E2E session identity matching without launching a browser.
 * Bridges user-profile response shapes and the shared authentication helper.
 * Exists so missing or swapped usernames cannot silently pass as authenticated sessions.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { describe, expect, it } from 'vitest';

import { loadOtpCode, sessionMatchesExpectedIdentity } from './auth';

describe('sessionMatchesExpectedIdentity', () => {
  it('accepts only the exact requested non-guest identity', () => {
    expect(sessionMatchesExpectedIdentity(
      { user_id: 4, username: 'test_admin' },
      'test_admin',
    )).toBe(true);
  });

  it.each([
    [{ user_id: 4 }, 'test_admin'],
    [{ user_id: 4, username: '' }, 'test_admin'],
    [{ user_id: 4, username: 'another_admin' }, 'test_admin'],
    [{ user_id: 1, username: 'test_admin' }, 'test_admin'],
    [{ user_id: 4, username: 'test_admin' }, '   '],
  ])('rejects an incomplete or mismatched session %#', (sessionInfo, expectedUsername) => {
    expect(sessionMatchesExpectedIdentity(sessionInfo, expectedUsername)).toBe(false);
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

  it('reads the external Easelect development environment without root compatibility files', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'easelect-e2e-key-root-'));
    const keyRoot = path.join(tempDir, 'filterest_keys');
    const developmentRoot = path.join(keyRoot, 'easelect_development');
    const devEnvFile = path.join(developmentRoot, 'development_environment.env');
    fs.mkdirSync(developmentRoot, { recursive: true });
    fs.writeFileSync(devEnvFile, 'LOGIN_OTP_CODE=345678\n', 'utf8');
    try {
      expect(loadOtpCode({
        environment: { EASELECT_KEY_ROOT: keyRoot },
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
