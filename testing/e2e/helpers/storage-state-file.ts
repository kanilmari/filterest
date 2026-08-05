/**
 * storage-state-file.ts
 * Writes Playwright authentication state atomically with owner-only permissions.
 * Exists because Playwright's path writer creates files with the process umask first.
 */

import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

export function ensureOwnerOnlyStorageStateDirectory(directoryPath: string): void {
  fs.mkdirSync(directoryPath, { recursive: true, mode: 0o700 });
  const directoryStats = fs.lstatSync(directoryPath);
  if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink()) {
    throw new Error(`E2E auth-state directory is not a real directory: ${directoryPath}`);
  }
  fs.chmodSync(directoryPath, 0o700);
}

export function writeOwnerOnlyJsonFile(filePath: string, value: unknown): void {
  const directoryPath = path.dirname(filePath);
  ensureOwnerOnlyStorageStateDirectory(directoryPath);

  const serialized = JSON.stringify(value, null, 2);
  if (serialized === undefined) {
    throw new Error('E2E auth-state value is not JSON-serializable.');
  }

  const temporaryPath = path.join(
    directoryPath,
    `.${path.basename(filePath)}.tmp-${process.pid}-${randomUUID()}`,
  );
  try {
    fs.writeFileSync(temporaryPath, `${serialized}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    fs.renameSync(temporaryPath, filePath);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
}

export function removeStorageStateFile(filePath: string): void {
  fs.rmSync(filePath, { force: true });
}
