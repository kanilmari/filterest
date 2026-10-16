/**
 * test-artifact-column-key-sources.ts
 * Saves complete source inventories before owned datasets lose their metadata.
 * Binds immutable snapshots to the run's existing confirmed column identities.
 * Keeps every observation so a later drop cannot erase an earlier foreign source.
 */
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { RegisteredTestArtifact } from './test-artifact-run-registry';
import type { DatasetColumns, LangKeySource } from './lang-key-drift-attribution';
import { generatedColumnKeys } from './bare-column-key-attribution';
import { readRecordedDatasetColumnIdentity } from './test-artifact-dataset-columns';
import { safeTestArtifactError } from './test-artifact-diagnostics';

export const COLUMN_KEY_SOURCES_DIRECTORY = 'dataset-column-key-sources';
type Snapshot = { version: 1; runId: string; name: string; serverId: number; column: string;
  key: string; sources: LangKeySource[] };
const invalid = () => safeTestArtifactError('Invalid E2E pre-drop column-key source evidence');
const digest = (contents: string) => crypto.createHash('sha256').update(contents).digest('hex') + '.json';
const validSource = (source: LangKeySource) => source && typeof source.source_type === 'string'
  && source.source_type !== '' && typeof source.source_high === 'string'
  && (source.source_low === null || typeof source.source_low === 'string');

/** Append observations; neither retries nor another owned child's drop can replace earlier evidence. */
export function rememberColumnKeySources(
  runDirectory: string, artifact: RegisteredTestArtifact, columns: readonly string[],
  sourcesByKey: ReadonlyMap<string, readonly LangKeySource[]>,
): void {
  if (artifact.kind !== 'dataset' || artifact.status !== 'confirmed' || !artifact.serverId) throw invalid();
  for (const column of columns) {
    if (readRecordedDatasetColumnIdentity(runDirectory, artifact.runId, artifact.name, column) !== artifact.serverId) {
      throw invalid();
    }
    for (const key of generatedColumnKeys(column)) {
      const sources = sourcesByKey.get(key);
      if (sources === undefined) continue; // An absent key supplies no evidence.
      if (!sources.every(validSource)) throw invalid();
      const snapshot: Snapshot = { version: 1, runId: artifact.runId, name: artifact.name,
        serverId: artifact.serverId, column, key, sources: [...sources] };
      const contents = JSON.stringify(snapshot) + '\n';
      const directory = path.join(runDirectory, COLUMN_KEY_SOURCES_DIRECTORY);
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      try { fs.writeFileSync(path.join(directory, digest(contents)), contents, { flag: 'wx', mode: 0o600 }); }
      catch (error) { if ((error as NodeJS.ErrnoException)?.code !== 'EEXIST') throw error; }
    }
  }
}

/** Missing snapshots remain missing; malformed, unowned or replaced identities fail closed. */
export function readRecordedColumnKeySources(
  runDirectory: string, runId: string, datasetNames: readonly string[], columnsByDataset: DatasetColumns,
): Map<string, LangKeySource[]> {
  const sources = new Map<string, LangKeySource[]>();
  const directory = path.join(runDirectory, COLUMN_KEY_SOURCES_DIRECTORY);
  if (!fs.existsSync(directory)) return sources;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile()) throw invalid();
    let contents: string;
    let record: Snapshot;
    try {
      contents = fs.readFileSync(path.join(directory, entry.name), 'utf8');
      record = JSON.parse(contents);
    } catch { throw invalid(); }
    if (entry.name !== digest(contents) || !record || record.version !== 1 || record.runId !== runId
      || !datasetNames.includes(record.name) || !columnsByDataset.get(record.name)?.includes(record.column)
      || !generatedColumnKeys(record.column).includes(record.key)
      || !Array.isArray(record.sources) || !record.sources.every(validSource)
      || readRecordedDatasetColumnIdentity(runDirectory, runId, record.name, record.column) !== record.serverId) throw invalid();
    const combined = [...(sources.get(record.key) ?? []), ...record.sources];
    sources.set(record.key, [...new Map(combined.map(source => [JSON.stringify(source), source])).values()]);
  }
  return sources;
}
