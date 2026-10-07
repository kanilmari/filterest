/** Verifies credential-scoped numeric reuse without saving either name or password. */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { initializeTestIdentityKey, clearVerifiedTestIdentities, readVerifiedTestIdentity, writeVerifiedTestIdentity } from './auth_identity';

let temporaryRoot: string;
afterEach(() => {
  vi.unstubAllEnvs();
  if (temporaryRoot) fs.rmSync(temporaryRoot, { recursive: true, force: true });
});
it('reuses only the account verified with these credentials on this origin', () => {
  temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'filterest-identity-'));
  vi.stubEnv('FILTEREST_TEST_RUNTIME_ROOT', temporaryRoot);
  vi.stubEnv('FILTEREST_E2E_IDENTITY_HMAC_KEY', 'run-one-key');
  const credentials = { username: 'private-canary-name', password: 'private-canary-password' };
  expect(readVerifiedTestIdentity(credentials, 'https://example.invalid/login')).toBeUndefined();
  writeVerifiedTestIdentity(credentials, 'https://example.invalid/login', 42);
  expect(readVerifiedTestIdentity(credentials, 'https://example.invalid/profile')).toBe(42);
  expect(readVerifiedTestIdentity(credentials, 'https://other.invalid')).toBeUndefined();
  expect(readVerifiedTestIdentity({ ...credentials, password: 'changed' }, 'https://example.invalid')).toBeUndefined();
  expect(readVerifiedTestIdentity({ ...credentials, username: 'other' }, 'https://example.invalid')).toBeUndefined();
  const filename = path.join(temporaryRoot, 'e2e', '.auth', 'verified-identities.json');
  const saved = fs.readFileSync(filename, 'utf8');
  expect(saved).not.toContain(credentials.username);
  expect(saved).not.toContain(credentials.password);
  expect(fs.statSync(filename).mode & 0o777).toBe(0o600);
  expect(() => writeVerifiedTestIdentity(credentials, 'https://example.invalid', 1)).toThrow();
  vi.stubEnv('FILTEREST_E2E_IDENTITY_HMAC_KEY', 'run-two-key');
  expect(readVerifiedTestIdentity(credentials, 'https://example.invalid')).toBeUndefined();
  vi.stubEnv('FILTEREST_E2E_IDENTITY_HMAC_KEY', '');
  initializeTestIdentityKey();
  const generatedKey = process.env.FILTEREST_E2E_IDENTITY_HMAC_KEY;
  expect(generatedKey).toMatch(/^[a-f0-9]{64}$/);
  initializeTestIdentityKey();
  expect(process.env.FILTEREST_E2E_IDENTITY_HMAC_KEY).toBe(generatedKey);
  clearVerifiedTestIdentities();
  expect(readVerifiedTestIdentity(credentials, 'https://example.invalid')).toBeUndefined();
});
