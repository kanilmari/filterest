// permissions-rights-fingerprint.ts
// Builds both rights fingerprints within a confirmed surviving dataset scope.
// Connects T23's snapshots and paged catalog to direct per-UID absence checks.
// Keeps concurrent deletion between catalog pages from hiding surviving grants.

/** Excludes a missing snapshot UID only after confirmAbsent proves it is gone; errors propagate. */
export async function buildRightsFingerprints(
  before: readonly Record<string, unknown>[],
  after: readonly Record<string, unknown>[],
  snapshotDatasetUIDs: ReadonlySet<number>,
  scannedDatasetUIDs: ReadonlySet<number>,
  confirmAbsent: (datasetUID: number) => Promise<boolean>,
) {
  const survivingDatasetUIDs = new Set<number>();
  for (const datasetUID of snapshotDatasetUIDs) {
    // OFFSET pagination can skip a survivor after an earlier catalog row is deleted.
    if (scannedDatasetUIDs.has(datasetUID) || !(await confirmAbsent(datasetUID))) {
      survivingDatasetUIDs.add(datasetUID);
    }
  }
  // Resolve scope once for both sides; globals always remain and new datasets never enter it.
  const normalize = (rows: readonly Record<string, unknown>[]) => rows
    .filter(row => row.target_table_uid === null ||
      survivingDatasetUIDs.has(Number(row.target_table_uid)))
    .map(row => ({
      group: row.user_group_id, function: row.function_id,
      scope: { schema: row.target_schema_name, datasetUID: row.target_table_uid || null },
    })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return { before: normalize(before), after: normalize(after) };
}
