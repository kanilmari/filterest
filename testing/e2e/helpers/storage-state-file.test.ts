/**
 * storage-state-file.test.ts
 * Verifies owner-only Playwright auth-state permissions and idempotent removal.
 * Exists to prevent session cookies from being left world-readable after E2E setup.
 */

// @vitest-environment node

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ensureOwnerOnlyStorageStateDirectory,
  removeStorageStateFile,
  writeOwnerOnlyJsonFile,
} from './storage-state-file';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

describe('Playwright storage-state file security', () => {
  it('creates and replaces auth state atomically under owner-only permissions', () => {
    const rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'easelect-storage-state-'));
    temporaryDirectories.push(rootDirectory);
    const authDirectory = path.join(rootDirectory, '.auth');
    const authFile = path.join(authDirectory, 'user.json');
    const originalUmask = process.umask(0);
    try {
      writeOwnerOnlyJsonFile(authFile, { cookies: [{ name: 'session', value: 'first' }] });
      writeOwnerOnlyJsonFile(authFile, { cookies: [{ name: 'session', value: 'second' }] });
    } finally {
      process.umask(originalUmask);
    }

    expect(fs.statSync(authDirectory).mode & 0o777).toBe(0o700);
    expect(fs.statSync(authFile).mode & 0o777).toBe(0o600);
    expect(JSON.parse(fs.readFileSync(authFile, 'utf8'))).toEqual({
      cookies: [{ name: 'session', value: 'second' }],
    });
    expect(fs.readdirSync(authDirectory)).toEqual(['user.json']);
  });

  it('rejects a symlink in place of the owner-only auth directory', () => {
    const rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'easelect-storage-state-'));
    temporaryDirectories.push(rootDirectory);
    const realDirectory = path.join(rootDirectory, 'real-auth');
    const linkedDirectory = path.join(rootDirectory, 'linked-auth');
    fs.mkdirSync(realDirectory);
    fs.symlinkSync(realDirectory, linkedDirectory, 'dir');

    expect(() => ensureOwnerOnlyStorageStateDirectory(linkedDirectory)).toThrow(
      'E2E auth-state directory is not a real directory',
    );
  });

  it('removes auth state idempotently', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'easelect-storage-state-'));
    temporaryDirectories.push(directory);
    const authFile = path.join(directory, 'user.json');
    fs.writeFileSync(authFile, '{}\n', 'utf8');

    removeStorageStateFile(authFile);
    removeStorageStateFile(authFile);

    expect(fs.existsSync(authFile)).toBe(false);
  });
});
