/**
 * test-artifact-dataset-columns.ts
 * Records exact column ownership while confirmed test datasets still exist.
 * Immutable per-column records survive per-test drops beside dataset history.
 * This evidence only narrows language-key attribution; it grants no cleanup authority.
 */
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { RegisteredTestArtifact } from './test-artifact-run-registry';
import { safeTestArtifactError } from './test-artifact-diagnostics';

type ColumnRecord = { version: 1; runId: string; name: string; serverId: number; column: string };
export const DATASET_COLUMNS_DIRECTORY = 'dataset-columns';
const invalid = () => safeTestArtifactError('Invalid E2E dataset column ownership evidence');
const validName = (value: unknown): value is string => typeof value === 'string'
  && value.trim() === value && value.length > 0 && value.length <= 512 && !value.includes('\0');
const filename = (name: string, column: string) => crypto.createHash('sha256')
  .update(`${name}\0${column}`).digest('hex') + '.json';

function readRecord(file: string, runId: string): ColumnRecord {
  let record: ColumnRecord;
  try { record = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw invalid(); }
  if (!record || record.version !== 1 || record.runId !== runId
    || !validName(record.name) || !validName(record.column)
    || !Number.isSafeInteger(record.serverId) || record.serverId <= 0
    || path.basename(file) !== filename(record.name, record.column)) throw invalid();
  return record;
}

/** Call with successful creation's column list, or validated metadata for server-created children. */
export function rememberConfirmedDatasetColumns(
  runDirectory: string, artifact: RegisteredTestArtifact, columns: readonly string[],
): void {
  if (artifact.kind !== 'dataset' || artifact.status !== 'confirmed' || !artifact.serverId
    || !Array.isArray(columns) || columns.some(column => !validName(column))) throw invalid();
  const datasetName = artifact.name;
  const directory = path.join(runDirectory, DATASET_COLUMNS_DIRECTORY);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  for (const column of new Set(columns)) {
    const file = path.join(directory, filename(datasetName, column));
    const record: ColumnRecord = { version: 1, runId: artifact.runId,
      name: datasetName, serverId: artifact.serverId!, column };
    try {
      fs.writeFileSync(file, JSON.stringify(record) + '\n', { flag: 'wx', mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'EEXIST') throw error;
      if (readRecord(file, artifact.runId).serverId !== artifact.serverId) throw invalid();
    }
  }
}

/** A column record alone cannot introduce a dataset: confirmed/history names must authorize it. */
export function readRecordedDatasetColumns(
  runDirectory: string, runId: string, datasetNames: readonly string[],
): Map<string, string[]> {
  const columns = new Map<string, string[]>();
  const identities = new Map<string, number>();
  const directory = path.join(runDirectory, DATASET_COLUMNS_DIRECTORY);
  if (!fs.existsSync(directory)) return columns;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile()) throw invalid();
    const record = readRecord(path.join(directory, entry.name), runId);
    if (!datasetNames.includes(record.name)
      || (identities.has(record.name) && identities.get(record.name) !== record.serverId)) throw invalid();
    identities.set(record.name, record.serverId);
    columns.set(record.name, [...(columns.get(record.name) ?? []), record.column]);
  }
  return columns;
}
