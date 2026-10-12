/**
 * test-artifact-startup-lock.ts
 * Serializes asynchronous recovery and synchronous artifact-run initialization.
 * Bridges filesystem ownership and the registry's PID/nonce process identity.
 * Prevents another Playwright setup from starting during authenticated recovery.
 */
import * as crypto from 'node:crypto';
import { safeTestArtifactError } from './test-artifact-diagnostics';
import * as fs from 'node:fs';
import * as path from 'node:path';

export const ARTIFACT_REGISTRY_PROCESS_NONCE = crypto.randomBytes(32).toString('hex');
const heldLocks = new Set<string>();

/** EPERM is live; only ESRCH proves that a registry owner has exited. */
export function isArtifactRegistryProcessActive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === 'EPERM') return true;
    if (code === 'ESRCH') return false;
    throw safeTestArtifactError(`Could not determine whether E2E artifact registry PID ${pid} is active`);
  }
}

function acquireStartupLock(registryRoot: string): () => void {
  const lockDirectory = `${registryRoot}.startup-lock`;
  fs.mkdirSync(path.dirname(lockDirectory), { recursive: true, mode: 0o700 });
  try {
    fs.mkdirSync(lockDirectory, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'EEXIST') throw error;
    const entries = fs.readdirSync(lockDirectory, { withFileTypes: true });
    if (entries.length !== 1 || !entries[0].isFile()) {
      throw safeTestArtifactError(`Corrupt or unfinished E2E startup lock at ${lockDirectory}`);
    }
    const ownerPath = path.join(lockDirectory, entries[0].name);
    let owner: { pid: number; processNonce: string };
    try {
      owner = JSON.parse(fs.readFileSync(ownerPath, 'utf8'));
      if (!Number.isSafeInteger(owner?.pid) || owner.pid <= 0
        || !/^[a-f0-9]{64}$/.test(owner.processNonce)
        || entries[0].name !== `owner-${owner.pid}-${owner.processNonce}.json`) {
        throw safeTestArtifactError('Invalid startup owner identity');
      }
    } catch {
      throw safeTestArtifactError(`Corrupt E2E startup lock at ${lockDirectory}`);
    }
    if (isArtifactRegistryProcessActive(owner.pid)) {
      throw safeTestArtifactError(`E2E startup/recovery belongs to active PID ${owner.pid}; parallel Playwright runs are not allowed`);
    }
    // Only the contender that unlinks this exact dead nonce may remove the
    // directory. A losing contender cannot remove a newly acquired lock.
    fs.unlinkSync(ownerPath);
    fs.rmdirSync(lockDirectory);
    fs.mkdirSync(lockDirectory, { mode: 0o700 });
  }
  const ownerPath = path.join(lockDirectory,
    `owner-${process.pid}-${ARTIFACT_REGISTRY_PROCESS_NONCE}.json`);
  fs.writeFileSync(ownerPath, JSON.stringify({
    pid: process.pid, processNonce: ARTIFACT_REGISTRY_PROCESS_NONCE,
  }), { flag: 'wx', mode: 0o600 });
  heldLocks.add(registryRoot);
  return () => {
    heldLocks.delete(registryRoot);
    fs.unlinkSync(ownerPath);
    fs.rmdirSync(lockDirectory);
  };
}

/** Holds exclusive startup ownership across login, recovery and initialization. */
export async function withArtifactRunStartupLock<T>(
  registryRoot: string, action: () => Promise<T>,
): Promise<T> {
  const release = acquireStartupLock(registryRoot);
  try {
    return await action();
  } finally {
    release();
  }
}

/** Allows the initializer inside its own asynchronous startup operation. */
export function withSynchronousArtifactRunStartupLock<T>(
  registryRoot: string, action: () => T,
): T {
  if (heldLocks.has(registryRoot)) return action();
  const release = acquireStartupLock(registryRoot);
  try {
    return action();
  } finally {
    release();
  }
}
