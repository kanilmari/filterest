/**
 * table-csv-artifact.ts
 * Tracks one reported U1/U2 CSV export and removes it only while its identity matches.
 * Bridges the server's export reply, local runtime roots, and spec teardown.
 * Exists so reads and cleanup use the reported file's identity, never another run's file.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  resolveFilterestStorageRuntimePaths,
  type FilterestTestRuntimeOptions,
} from './test-runtime-paths';

type CSVArtifact = { csvPath: string; device: bigint; inode: bigint };

function assertUnlinkedParent(csvPath: string): void {
  let existingParent = path.dirname(csvPath);
  while (!fs.lstatSync(existingParent, { throwIfNoEntry: false })) {
    existingParent = path.dirname(existingParent);
  }
  if (fs.realpathSync.native(existingParent) !== existingParent) {
    throw new Error(`Refusing CSV artifact path through a symbolic link: ${csvPath}`);
  }
}

function assertArtifactIdentity(artifact: CSVArtifact, file: fs.BigIntStats | undefined): void {
  if (!file) {
    throw new Error(`CSV artifact disappeared: ${artifact.csvPath}`);
  }
  if (!file.isFile()) {
    throw new Error(`CSV artifact is not a regular file: ${artifact.csvPath}`);
  }
  if (file.dev !== artifact.device || file.ino !== artifact.inode) {
    throw new Error(`CSV artifact identity changed; leaving it untouched: ${artifact.csvPath}`);
  }
}

function cleanupCSVArtifact(
  artifact: CSVArtifact | undefined, datasetName: string, primaryErrors: unknown[],
): void {
  // No valid reply means no file identity was established, even if a candidate appeared.
  if (!artifact) return;
  try {
    assertUnlinkedParent(artifact.csvPath);
    assertArtifactIdentity(
      artifact, fs.lstatSync(artifact.csvPath, { bigint: true, throwIfNoEntry: false }),
    );
    fs.unlinkSync(artifact.csvPath);
  } catch (error) {
    throw new AggregateError(
      [...primaryErrors, error], `Failed to clean the CSV exported for ${datasetName}.`,
    );
  }
}

/**
 * Allows only this run's previously absent CSV in the server's two runtime layouts.
 * The resolver records the reported regular file's device and inode; the reader verifies
 * that identity on a non-following descriptor. Cleanup unlinks only that same reported
 * file before dataset teardown, leaving unreported or replaced files untouched.
 */
export async function withTableCSVArtifact<T>(
  datasetName: string,
  operation: (
    resolveExportPath: (body: string) => string, readExportCSV: () => Buffer,
  ) => Promise<T>,
  options: FilterestTestRuntimeOptions = {},
): Promise<T> {
  if (!/^e2e_(?:import|export)_csv_[a-z0-9_]+$/.test(datasetName)) {
    throw new Error('CSV artifact cleanup requires a U1/U2-generated dataset name.');
  }
  const { projectBoundary } = resolveFilterestStorageRuntimePaths(options);
  // These are the layouts in backend/core_components/dev_tools/table_csv_runtime_paths.go.
  // The test output/download directory does not determine the server's export directory.
  const csvPaths = [
    path.join(projectBoundary, 'tables_data', `${datasetName}.csv`),
    path.join(projectBoundary, 'data', 'runtime', 'tables_data', `${datasetName}.csv`),
  ];
  for (const csvPath of csvPaths) {
    assertUnlinkedParent(csvPath);
    if (fs.lstatSync(csvPath, { throwIfNoEntry: false })) {
      throw new Error(`Refusing to overwrite or clean a pre-existing CSV: ${csvPath}`);
    }
  }

  let artifact: CSVArtifact | undefined;
  const resolveExportPath = (body: string): string => {
    if (artifact) {
      throw new Error('CSV export identity has already been recorded.');
    }
    const prefix = `exported ${datasetName} to `;
    if (!body.startsWith(prefix)) {
      throw new Error(`Unexpected CSV export reply: ${body}`);
    }
    // Older servers returned a relative path anchored to their installation root.
    const csvPath = path.resolve(projectBoundary, body.slice(prefix.length));
    if (!csvPaths.includes(csvPath)) {
      throw new Error(`CSV export reply is outside the expected runtime locations: ${body}`);
    }
    assertUnlinkedParent(csvPath);
    const file = fs.lstatSync(csvPath, { bigint: true });
    if (!file.isFile()) {
      throw new Error(`CSV export is not a regular file: ${csvPath}`);
    }
    artifact = { csvPath, device: file.dev, inode: file.ino };
    return csvPath;
  };

  const readExportCSV = (): Buffer => {
    if (!artifact) {
      throw new Error('Resolve the CSV export reply before reading its file.');
    }
    assertUnlinkedParent(artifact.csvPath);
    assertArtifactIdentity(
      artifact, fs.lstatSync(artifact.csvPath, { bigint: true, throwIfNoEntry: false }),
    );
    const noFollowFlag = fs.constants.O_NOFOLLOW;
    if (!Number.isInteger(noFollowFlag)) {
      throw new Error('This platform cannot safely open a CSV without following symbolic links.');
    }
    const descriptor = fs.openSync(
      artifact.csvPath, fs.constants.O_RDONLY | noFollowFlag | fs.constants.O_NONBLOCK,
    );
    try {
      // Opening and inspecting the descriptor closes the leaf replacement gap before reading.
      assertArtifactIdentity(artifact, fs.fstatSync(descriptor, { bigint: true }));
      return fs.readFileSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
  };

  const primaryErrors: unknown[] = [];
  try {
    return await operation(resolveExportPath, readExportCSV);
  } catch (error) {
    primaryErrors.push(error);
    throw error;
  } finally {
    cleanupCSVArtifact(artifact, datasetName, primaryErrors);
  }
}
