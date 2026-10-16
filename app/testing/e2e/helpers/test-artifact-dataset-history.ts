/**
 * Keeps confirmed dataset ownership until teardown, even after per-test cleanup.
 * Links immutable registry evidence rather than rewriting a shared worker manifest.
 * This history authorizes language-key attribution only, never server cleanup.
 */
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { RegisteredTestArtifact } from './test-artifact-run-registry';
import { safeTestArtifactError } from './test-artifact-diagnostics';

export const DATASET_HISTORY_DIRECTORY = 'dataset-history';

function readDatasetHistory(file: string, runId: string): RegisteredTestArtifact {
  let entry: RegisteredTestArtifact;
  try { entry = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {
    throw safeTestArtifactError('Unreadable E2E dataset history');
  }
  if (!entry || entry.runId !== runId || entry.kind !== 'dataset' || entry.status !== 'confirmed'
    || typeof entry.name !== 'string' || !entry.name.trim() || entry.name.length > 512
    || !Number.isSafeInteger(entry.serverId) || Number(entry.serverId) <= 0) {
    throw safeTestArtifactError('Invalid E2E dataset history');
  }
  const digest = crypto.createHash('sha256').update(`dataset\0${entry.name}`, 'utf8').digest('hex');
  if (path.basename(file) !== `${digest}.json`) throw safeTestArtifactError('Mismatched E2E dataset history');
  return entry;
}

/** Called only with a validated registry entry, before that entry is unregistered. */
export function rememberCompletedDataset(
  runDirectory: string, entryPath: string, artifact: RegisteredTestArtifact,
): void {
  if (artifact.kind !== 'dataset' || artifact.status !== 'confirmed') return;
  const directory = path.join(runDirectory, DATASET_HISTORY_DIRECTORY);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const historyPath = path.join(directory, path.basename(entryPath));
  try { fs.linkSync(entryPath, historyPath); } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'EEXIST') throw error;
    const existing = readDatasetHistory(historyPath, artifact.runId);
    if (existing.name !== artifact.name || existing.serverId !== artifact.serverId) {
      throw safeTestArtifactError('Conflicting E2E dataset history');
    }
  }
}

export function readCompletedDatasetNames(runDirectory: string, runId: string): string[] {
  const directory = path.join(runDirectory, DATASET_HISTORY_DIRECTORY);
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).map(file => {
    if (!file.isFile()) throw safeTestArtifactError('Unexpected E2E dataset history entry');
    return readDatasetHistory(path.join(directory, file.name), runId).name;
  }).sort();
}
