// auth_identity.ts
// Remembers numeric identities proven by a fresh credential login for browser-test reuse.
// Bridges owner-only runtime artifacts and the auth helpers; public names never identify accounts.
// Credentials are represented by a digest, scoped to the service origin, never stored in this file.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHmac, randomBytes } from 'node:crypto';
import { resolveFilterestTestRuntimePaths } from './test-runtime-paths';
import { writeOwnerOnlyJsonFile } from './storage-state-file';
import type { TestCredentials } from './auth';

/** Creates a per-run key in the environment inherited by Playwright workers. */
export function initializeTestIdentityKey(): void {
  if (!process.env.FILTEREST_E2E_IDENTITY_HMAC_KEY) {
    process.env.FILTEREST_E2E_IDENTITY_HMAC_KEY = randomBytes(32).toString('hex');
  }
}
const identityFile = () => path.join(resolveFilterestTestRuntimePaths().authDirectory, 'verified-identities.json');
function identityKey(credentials: TestCredentials, url: string): string {
  const key = process.env.FILTEREST_E2E_IDENTITY_HMAC_KEY;
  if (!key) throw new Error('E2E identity key missing; run global setup first.');
  return createHmac('sha256', key).update(JSON.stringify([new URL(url).origin, credentials.username, credentials.password])).digest('hex');
}
function readIdentities(): Record<string, number> {
  if (!fs.existsSync(identityFile())) return {};
  return JSON.parse(fs.readFileSync(identityFile(), 'utf8'));
}
export function readVerifiedTestIdentity(credentials: TestCredentials, url: string): number | undefined {
  const id = readIdentities()[identityKey(credentials, url)];
  return Number.isSafeInteger(id) && id > 1 ? id : undefined;
}
export function writeVerifiedTestIdentity(credentials: TestCredentials, url: string, id: number): void {
  if (!Number.isSafeInteger(id) || id <= 1) throw new Error('Cannot remember a guest or invalid account id.');
  writeOwnerOnlyJsonFile(identityFile(), { ...readIdentities(), [identityKey(credentials, url)]: id });
}
export function clearVerifiedTestIdentities(): void { fs.rmSync(identityFile(), { force: true }); }
