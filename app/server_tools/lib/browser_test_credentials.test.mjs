// browser_test_credentials.test.mjs
// Verifies protected credential and OTP resolution across Filterest compositions.
// Bridges standalone installation roots and true embedded Easelect source markers.
// Exists so browser tooling never falls back to secret files inside immutable app/.

import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  loadBrowserTestCredentials,
  resolveBrowserTestCredentialFilePath,
  resolveBrowserTestOtpCode,
  writeBrowserTestCredentialsFile,
} from './browser_test_credentials.mjs';

const temporaryRoots = [];

function temporaryRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filterest-browser-creds-'));
  temporaryRoots.push(root);
  return root;
}

function markApplication(applicationRoot) {
  fs.mkdirSync(applicationRoot, { recursive: true });
  fs.writeFileSync(path.join(applicationRoot, 'go.mod'), 'module filterest\n');
  fs.writeFileSync(path.join(applicationRoot, 'VERSION_APP'), 'test\n');
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('protected browser-test runtime contract', () => {
  test('standalone tools use installation-owned keys and never app-local fallbacks', () => {
    const installationRoot = path.join(temporaryRoot(), 'filterest');
    const applicationRoot = path.join(installationRoot, 'app');
    markApplication(applicationRoot);
    fs.writeFileSync(path.join(applicationRoot, '.env'), 'LOGIN_OTP_CODE=app-wrong\n');
    fs.writeFileSync(
      path.join(applicationRoot, 'dev_env_test_creds.txt'),
      'TEST_ADMIN_USER=app-wrong\nTEST_ADMIN_PASS=app-wrong\n',
    );
    const protectedRoot = path.join(installationRoot, 'keys', 'filterest_runtime');
    fs.mkdirSync(protectedRoot, { recursive: true, mode: 0o700 });
    fs.chmodSync(protectedRoot, 0o700);
    fs.writeFileSync(
      path.join(protectedRoot, 'dev_env_test_creds.txt'),
      'TEST_ADMIN_USER=standalone-admin\nTEST_ADMIN_PASS=standalone-password\n',
      { mode: 0o600 },
    );
    fs.writeFileSync(
      path.join(protectedRoot, 'development_environment.env'),
      'LOGIN_OTP_CODE=standalone-otp\n',
      { mode: 0o600 },
    );

    expect(resolveBrowserTestCredentialFilePath({ applicationRoot })).toBe(
      path.join(protectedRoot, 'dev_env_test_creds.txt'),
    );
    expect(loadBrowserTestCredentials({ applicationRoot })).toEqual({
      username: 'standalone-admin',
      password: 'standalone-password',
    });
    expect(resolveBrowserTestOtpCode({ applicationRoot })).toBe('standalone-otp');
  });

  test('embedded tools use the outer Easelect credential and protected key root', () => {
    const easelectRoot = path.join(temporaryRoot(), 'easelect');
    const applicationRoot = path.join(easelectRoot, 'filterest', 'app');
    const keyRoot = path.join(path.dirname(easelectRoot), 'protected-keys');
    fs.mkdirSync(path.join(easelectRoot, '.git'), { recursive: true });
    fs.writeFileSync(path.join(easelectRoot, 'VERSION_EASELECT'), 'test\n');
    markApplication(applicationRoot);
    fs.writeFileSync(path.join(applicationRoot, '.env'), 'LOGIN_OTP_CODE=app-wrong\n');
    fs.writeFileSync(path.join(applicationRoot, 'dev_env.txt'), 'LOGIN_OTP_CODE=app-wrong\n');
    fs.writeFileSync(
      path.join(easelectRoot, 'dev_env_test_creds.txt'),
      'TEST_ADMIN_USER=easelect-admin\nTEST_ADMIN_PASS=easelect-password\n',
      { mode: 0o600 },
    );
    const protectedRuntime = path.join(keyRoot, 'easelect_development');
    fs.mkdirSync(protectedRuntime, { recursive: true, mode: 0o700 });
    fs.writeFileSync(
      path.join(protectedRuntime, 'development_environment.env'),
      'LOGIN_OTP_CODE=easelect-otp\n',
      { mode: 0o600 },
    );
    const environment = { EASELECT_KEY_ROOT: keyRoot };

    expect(resolveBrowserTestCredentialFilePath({ applicationRoot, environment })).toBe(
      path.join(easelectRoot, 'dev_env_test_creds.txt'),
    );
    expect(loadBrowserTestCredentials({ applicationRoot, environment })).toEqual({
      username: 'easelect-admin',
      password: 'easelect-password',
    });
    expect(resolveBrowserTestOtpCode({ applicationRoot, environment })).toBe(
      'easelect-otp',
    );
    expect(
      writeBrowserTestCredentialsFile({
        applicationRoot,
        contents: 'TEST_ADMIN_USER=updated-admin\nTEST_ADMIN_PASS=updated-password\n',
        environment,
      }),
    ).toBe(path.join(easelectRoot, 'dev_env_test_creds.txt'));
    expect(fs.readFileSync(path.join(applicationRoot, 'dev_env.txt'), 'utf8')).toBe(
      'LOGIN_OTP_CODE=app-wrong\n',
    );
  });

  test('browser tooling accepts the standard protected API automation credential', () => {
    const easelectRoot = path.join(temporaryRoot(), 'easelect');
    const applicationRoot = path.join(easelectRoot, 'filterest', 'app');
    const credentialFile = path.join(temporaryRoot(), 'filterest-agent.env');
    fs.mkdirSync(path.join(easelectRoot, '.git'), { recursive: true });
    fs.writeFileSync(path.join(easelectRoot, 'VERSION_EASELECT'), 'test\n');
    markApplication(applicationRoot);
    fs.writeFileSync(
      credentialFile,
      'FILTEREST_API_BASE_URL=https://localhost:8082\n'
        + 'FILTEREST_API_USERNAME=filterest_agent\n'
        + 'FILTEREST_API_PASSWORD=protected-password\n',
      { mode: 0o600 },
    );

    expect(loadBrowserTestCredentials({
      applicationRoot,
      environment: { FILTEREST_TEST_CREDENTIAL_FILE: credentialFile },
    })).toEqual({
      username: 'filterest_agent',
      password: 'protected-password',
    });
  });

  test('an explicit wrapper boundary keeps an embedded public invocation standalone', () => {
    const easelectRoot = path.join(temporaryRoot(), 'easelect');
    const installationRoot = path.join(easelectRoot, 'filterest');
    const applicationRoot = path.join(installationRoot, 'app');
    fs.mkdirSync(path.join(easelectRoot, '.git'), { recursive: true });
    fs.writeFileSync(path.join(easelectRoot, 'VERSION_EASELECT'), 'test\n');
    markApplication(applicationRoot);
    const environment = { FILTEREST_PROJECT_ROOT_OVERRIDE: installationRoot };

    expect(resolveBrowserTestCredentialFilePath({ applicationRoot, environment })).toBe(
      path.join(
        installationRoot,
        'keys',
        'filterest_runtime',
        'dev_env_test_creds.txt',
      ),
    );
  });
});
