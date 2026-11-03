/**
 * test-artifact-generated-names.test.ts
 * Proves temporary names cross the real stale-run ownership gate at generation time.
 * Uses the browser callers' prefixes and the shared recovery API/registry fakes.
 * Keeps interrupted creation recoverable without loosening foreign-data safeguards.
 */
// @vitest-environment node
import { describe, expect, test, vi } from 'vitest';
import { buildTempDatasetName } from './temp-dataset';
import { initializeArtifactRunRegistry } from './test-artifact-run-registry';
import {
  DEAD_PID, RUN_ID, START, TARGET, root, fakeApi, seedArtifact, recover, useRecoveryRegistry,
} from './test-artifact-recovery-fakes';

const projects = ['mobile_card', 'mobile_bigcard', 'tablet_card', 'tablet_bigcard',
  'desktop_card', 'desktop_bigcard'];
const prefixes = [
  ...projects.flatMap(project => [`e2e_perm_table_${project}`, `e2e_deletion_table_${project}`]),
  'e2e_palette_cover', 'e2e_palette_a', 'e2e_palette_b', 'e2e_table_cell_lines',
  'app_e2e_ns_owner', 'e2e', '', // App namespace, whole-word marker and empty-prefix fallback.
  'e2e_folder_table', 'e2e_folder', // T9: dataset and folder.
  'e2e_folder_control', 'e2e_folder_rejected', // T4: folders (recovery still supports datasets only).
  ...['x', 'y', 'unselected'].map(suffix => `e2e_k390_${suffix}`), // T23: before generation.
  'e2e_card_visibility_desktop_bigcard', // Existing project-bearing helper caller.
  'e2e_perm_table_' + 'long_project_'.repeat(8),
  'e2e_' + 'long_prefix_'.repeat(8),
  'e2e_a' + '_'.repeat(100) + 'b', // Truncation must not leave a trailing prefix separator.
];

describe('browser artifact names at the stale-run ownership boundary', () => {
  useRecoveryRegistry();

  for (const startedAfter of [false, true]) {
    test.each(prefixes)(`%s: run starts ${startedAfter ? 'after' : 'just before'} generation`, async prefix => {
      const generatedAt = Date.parse(START);
      vi.spyOn(Date, 'now').mockReturnValue(generatedAt);
      // Zero used to produce an empty random suffix; all names still need six characters.
      vi.spyOn(Math, 'random').mockReturnValue(0);
      const name = buildTempDatasetName(prefix);
      expect(name.length).toBeLessThanOrEqual(63);
      expect(name).toMatch(/(^|_)e2e(_|$)/);
      if (prefix.length < 40) expect(name.startsWith(`${prefix || 'e2e_temp_dataset'}_`)).toBe(true);
      initializeArtifactRunRegistry({ rootDirectory: root, runId: RUN_ID, pid: DEAD_PID,
        now: new Date(generatedAt + (startedAfter ? 1 : -1)), target: TARGET });
      seedArtifact(name, 'planned');
      const api = fakeApi({ [name]: { uid: 921 } });
      const { log } = await recover(api);
      expect(api.post).toHaveBeenCalledTimes(startedAfter ? 0 : 1);
      expect(Boolean(api.datasets[name])).toBe(startedAfter);
      expect(log).toHaveBeenCalledWith(expect.stringContaining(startedAfter
        ? 'outcome=skipped: generated name at or after run start not proven' : 'outcome=dropped'));
    });
  }

  test.each(['dataset_without_marker', 'abce2ex', 'a'.repeat(100) + '_e2e',
    'a'.repeat(44) + '_e2e'])('%s: refuses a prefix without a surviving marker', prefix => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse(START));
    expect(() => buildTempDatasetName(prefix)).toThrow(new Error(
      `Temp dataset prefix "${prefix}" must retain a whole "e2e" word after normalization and truncation; `
      + 'use "e2e_..." or "app_e2e_...".',
    ));
  });

  test.each(['e2e_catalog_media', 'e2e_article_toolbar', ...projects.flatMap(project =>
    [`e2e_perm_table_${project}`, `e2e_deletion_table_${project}`])])('%s: canonical asset child keeps the same time proof', async prefix => {
    const generatedAt = Date.parse(START);
    vi.spyOn(Date, 'now').mockReturnValue(generatedAt);
    const name = `${buildTempDatasetName(prefix)}_assets`;
    expect(name.length).toBeLessThanOrEqual(63);
    seedArtifact(name, 'planned');
    const api = fakeApi({ [name]: { uid: 922 } });
    await recover(api);
    expect(api.post).toHaveBeenCalledOnce();
  });
});
