// test-credential-file.test.ts
// Verifies the browser-test credential file stays outside immutable app source.
// Bridges standalone defaults with explicit Easelect and operator path overrides.
// Exists so E2E setup cannot silently recreate credentials under app/.
// @vitest-environment node

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  resolveTestCredentialFilePath,
  writeTestCredentialsFile,
} from './auth';

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const temporaryRoot of temporaryRoots.splice(0)) {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

describe('protected browser-test credential file', () => {
  test('standalone app defaults to its mutable keys sibling', () => {
    const installationRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'filterest-test-installation-'),
    );
    temporaryRoots.push(installationRoot);
    fs.mkdirSync(path.join(installationRoot, 'app'));
    expect(resolveTestCredentialFilePath({}, path.join(installationRoot, 'app'))).toBe(
      path.join(
        installationRoot,
        'keys',
        'filterest_runtime',
        'dev_env_test_creds.txt',
      ),
    );
  });

  test('explicit Easelect credential path is preserved and written owner-only', () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'filterest-test-creds-'));
    temporaryRoots.push(temporaryRoot);
    const applicationRoot = path.join(temporaryRoot, 'filterest', 'app');
    fs.mkdirSync(applicationRoot, { recursive: true });
    const credentialParent = path.join(temporaryRoot, 'protected');
    fs.mkdirSync(credentialParent, { mode: 0o755 });
    fs.chmodSync(credentialParent, 0o755);
    const configuredPath = path.join(
      credentialParent,
      'temporary',
      '..',
      'dev_env_test_creds.txt',
    );
    const credentialPath = path.resolve(configuredPath);
    const environment = { FILTEREST_TEST_CREDENTIAL_FILE: configuredPath };

    expect(resolveTestCredentialFilePath(environment, applicationRoot)).toBe(credentialPath);
    expect(
      writeTestCredentialsFile(
        'TEST_ADMIN_USER=test_admin\n',
        environment,
        applicationRoot,
      ),
    ).toBe(credentialPath);
    expect(fs.readFileSync(credentialPath, 'utf8')).toBe('TEST_ADMIN_USER=test_admin\n');
    expect(fs.statSync(credentialParent).mode & 0o777).toBe(0o755);
    expect(fs.statSync(credentialPath).mode & 0o777).toBe(0o600);
  });

  test('creates a missing standalone credential scope with owner-only permissions', () => {
    const installationRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'filterest-test-new-scope-'),
    );
    temporaryRoots.push(installationRoot);
    const applicationRoot = path.join(installationRoot, 'app');
    fs.mkdirSync(applicationRoot);

    const credentialPath = writeTestCredentialsFile(
      'TEST_ADMIN_USER=test_admin\n',
      {},
      applicationRoot,
    );

    expect(credentialPath).toBe(
      path.join(
        installationRoot,
        'keys',
        'filterest_runtime',
        'dev_env_test_creds.txt',
      ),
    );
    expect(fs.statSync(path.dirname(credentialPath)).mode & 0o777).toBe(0o700);
    expect(fs.statSync(credentialPath).mode & 0o777).toBe(0o600);
  });

  test('refuses a world-writable explicit parent without changing its mode', () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'filterest-test-parent-'));
    temporaryRoots.push(temporaryRoot);
    const applicationRoot = path.join(temporaryRoot, 'app');
    fs.mkdirSync(applicationRoot);
    const existingParent = path.join(temporaryRoot, 'other');
    fs.mkdirSync(existingParent);
    fs.chmodSync(existingParent, 0o777);
    const credentialPath = path.join(existingParent, 'dev_env_test_creds.txt');
    const environment = { FILTEREST_TEST_CREDENTIAL_FILE: credentialPath };

    expect(() => writeTestCredentialsFile('must-not-write', environment, applicationRoot))
      .toThrow(/writable by other users/);
    expect(fs.statSync(existingParent).mode & 0o777).toBe(0o777);
    expect(fs.existsSync(credentialPath)).toBe(false);
  });

  test('rejects an explicit path inside immutable app source', () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'filterest-test-app-'));
    temporaryRoots.push(temporaryRoot);
    const applicationRoot = path.join(temporaryRoot, 'app');
    fs.mkdirSync(applicationRoot);
    const environment = {
      FILTEREST_TEST_CREDENTIAL_FILE: path.join(applicationRoot, 'test-creds.txt'),
    };

    expect(() => resolveTestCredentialFilePath(environment, applicationRoot)).toThrow(
      /outside the immutable Filterest app directory/,
    );
    expect(() => writeTestCredentialsFile('never-written', environment, applicationRoot))
      .toThrow(/outside the immutable Filterest app directory/);
  });

  test('rejects a parent symlink that resolves the credential path into app', () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'filterest-test-link-'));
    temporaryRoots.push(temporaryRoot);
    const applicationRoot = path.join(temporaryRoot, 'app');
    fs.mkdirSync(applicationRoot);
    const linkedParent = path.join(temporaryRoot, 'linked-parent');
    fs.symlinkSync(applicationRoot, linkedParent, 'dir');
    const environment = {
      FILTEREST_TEST_CREDENTIAL_FILE: path.join(linkedParent, 'test-creds.txt'),
    };

    expect(() => resolveTestCredentialFilePath(environment, applicationRoot)).toThrow(
      /outside the immutable Filterest app directory/,
    );
  });

  test('rejects a credential-file symlink without changing its external target', () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'filterest-test-file-link-'));
    temporaryRoots.push(temporaryRoot);
    const applicationRoot = path.join(temporaryRoot, 'app');
    fs.mkdirSync(applicationRoot);
    const credentialParent = path.join(temporaryRoot, 'protected');
    fs.mkdirSync(credentialParent, { mode: 0o700 });
    const externalTarget = path.join(temporaryRoot, 'external-target.txt');
    fs.writeFileSync(externalTarget, 'unchanged');
    const credentialPath = path.join(credentialParent, 'dev_env_test_creds.txt');
    fs.symlinkSync(externalTarget, credentialPath);
    const environment = { FILTEREST_TEST_CREDENTIAL_FILE: credentialPath };

    expect(() => resolveTestCredentialFilePath(environment, applicationRoot))
      .toThrow(/symbolic link/);
    expect(() => writeTestCredentialsFile('must-not-leak', environment, applicationRoot))
      .toThrow(/symbolic link/);
    expect(fs.readFileSync(externalTarget, 'utf8')).toBe('unchanged');
    expect(fs.lstatSync(credentialPath).isSymbolicLink()).toBe(true);
  });
});
