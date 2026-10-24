// permissions-rights-fingerprint.test.ts
// Proves that dataset lifecycle changes do not hide permission changes.
// Connects T23's shared comparison helper to catalog snapshots and per-UID confirmations.
// Covers deletions between pages while keeping surviving grants and globals strict.
import { describe, expect, it, vi } from 'vitest';
import { buildRightsFingerprints } from './permissions-rights-fingerprint';

const right = (target_table_uid: number | null, function_id = 2) => ({
  user_group_id: 1, function_id, target_schema_name: 'public', target_table_uid,
});

describe('permissions rights fingerprint scope', () => {
  it('excludes a deleted snapshot dataset only after confirming its absence', async () => {
    const before = [right(null), right(10), right(20)];
    const after = [right(null), right(10)];
    const snapshotDatasetUIDs = new Set([10, 20]);
    const scannedDatasetUIDs = new Set([10]);
    const confirmAbsent = vi.fn(async (datasetUID: number) => datasetUID === 20);
    const fingerprints = await buildRightsFingerprints(before, after, snapshotDatasetUIDs,
      scannedDatasetUIDs, confirmAbsent);

    expect(confirmAbsent).toHaveBeenCalledExactlyOnceWith(20);
    expect(fingerprints.after).toEqual(fingerprints.before);
    expect(fingerprints.before).toHaveLength(2);
  });

  it('detects a changed grant on a survivor skipped by a deletion between catalog pages', async () => {
    const catalog = Array.from({ length: 41 }, (_, index) => ({ table_uid: index + 1 }));
    const snapshotDatasetUIDs = new Set(catalog.map(row => row.table_uid));
    // Rights are read before the catalog; UID 21's grant has changed.
    const before = [right(null), right(21)];
    const after = [right(null), right(21, 3)];
    const firstPage = catalog.slice(0, 20);
    catalog.splice(4, 1); // UID 5 is deleted after page one; UID 21 shifts before OFFSET 20.
    const secondPage = catalog.slice(20, 40);
    const scannedDatasetUIDs = new Set([...firstPage, ...secondPage].map(row => row.table_uid));
    expect(scannedDatasetUIDs.has(21)).toBe(false);
    const confirmAbsent = vi.fn(async (datasetUID: number) =>
      catalog.filter(row => row.table_uid === datasetUID).length === 0);

    const fingerprints = await buildRightsFingerprints(before, after, snapshotDatasetUIDs,
      scannedDatasetUIDs, confirmAbsent);

    expect(confirmAbsent).toHaveBeenCalledExactlyOnceWith(21);
    expect(fingerprints.before).toContainEqual({ group: 1, function: 2,
      scope: { schema: 'public', datasetUID: 21 } });
    expect(fingerprints.after).not.toEqual(fingerprints.before);
  });

  it('propagates an unsuccessful absence check instead of excluding the dataset', async () => {
    const confirmAbsent = vi.fn(async () => { throw new Error('Catalog read failed'); });

    await expect(buildRightsFingerprints([right(10)], [], new Set([10]), new Set(), confirmAbsent))
      .rejects.toThrow('Catalog read failed');
  });

  it.each([
    ['all grants removed', []],
    ['grant changed', [right(10, 3)]],
    ['grant added', [right(10), right(10, 3)]],
  ] as const)('detects a still-present dataset with %s', async (_name, after) => {
    const datasetUIDs = new Set([10]);
    const confirmAbsent = vi.fn(async () => true);
    const fingerprints = await buildRightsFingerprints([right(10)], after, datasetUIDs, datasetUIDs, confirmAbsent);

    expect(confirmAbsent).not.toHaveBeenCalled();
    expect(fingerprints.after).not.toEqual(fingerprints.before);
  });

  it('ignores grants for a dataset created after the snapshot', async () => {
    const before = [right(null), right(10)];
    const snapshotDatasetUIDs = new Set([10]);
    const presentDatasetUIDs = new Set([10, 30]);
    const confirmAbsent = vi.fn(async () => true);
    const fingerprints = await buildRightsFingerprints(before, [...before, right(30)], snapshotDatasetUIDs,
      presentDatasetUIDs, confirmAbsent);

    expect(confirmAbsent).not.toHaveBeenCalled();
    expect(fingerprints.after).toEqual(fingerprints.before);
  });

  it('retains global grants even with no datasets and detects their removal or change', async () => {
    const noDatasets = new Set<number>();
    const confirmAbsent = vi.fn(async () => true);
    const removed = await buildRightsFingerprints([right(null)], [], noDatasets, noDatasets, confirmAbsent);
    const changed = await buildRightsFingerprints([right(null)], [right(null, 3)], noDatasets, noDatasets, confirmAbsent);

    expect(confirmAbsent).not.toHaveBeenCalled();
    expect(removed.before).toEqual([{ group: 1, function: 2, scope: { schema: 'public', datasetUID: null } }]);
    expect(removed.after).not.toEqual(removed.before);
    expect(changed.after).not.toEqual(changed.before);
  });
});
