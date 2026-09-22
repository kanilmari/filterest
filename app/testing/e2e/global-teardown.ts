// global-teardown.ts
// Removes synthetic browser-test data after the end-to-end test suite.
// Bridges authenticated Playwright state with API-backed test-data cleanup.
// Exists so interrupted or failed tests do not leave operator-visible residue.

import type { FullConfig } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import {
  cleanupSyntheticTestArtifactsWithStorageState,
  normalizeE2EBaseURL,
  readLangKeyInventoryWithStorageState,
  validateSyntheticArtifactBaseline,
} from './helpers/test-artifact-cleanup';
import {
  finishArtifactRunRegistry,
  getArtifactRegistryProcessIdentity,
  getCurrentArtifactRun,
  listRegisteredTestArtifacts,
  unregisterTestArtifact,
  type CurrentArtifactRun,
} from './helpers/test-artifact-run-registry';
import {
  attributeLangKeyDrift,
  describeMigrationSeededKeys,
  resolveMigrationDirectories,
} from './helpers/lang-key-drift-attribution';
import { removeStorageStateFile } from './helpers/storage-state-file';
import { resolveFilterestTestRuntimePaths } from './helpers/test-runtime-paths';
import { resolveLocalFilterestBaseUrl } from '../../server_tools/scripts/local_filterest_target.cjs';

const APPLICATION_ROOT = path.resolve(__dirname, '../..');
const testRuntimePaths = resolveFilterestTestRuntimePaths();
const AUTH_FILE = testRuntimePaths.authStorageState;
const ARTIFACT_BASELINE_FILE = path.join(
  testRuntimePaths.authDirectory,
  'artifact-baseline.json',
);

function diffSortedKeys(nextKeys: string[], baselineKeys: string[]) {
  const nextSet = new Set(nextKeys);
  const baselineSet = new Set(baselineKeys);

  const added = nextKeys.filter((key) => !baselineSet.has(key));
  const removed = baselineKeys.filter((key) => !nextSet.has(key));
  return { added, removed };
}

function resolveBaseURL(config: FullConfig): string {
  const configuredBaseURL = config.projects[0]?.use?.baseURL;
  return typeof configuredBaseURL === 'string' && configuredBaseURL.trim() !== ''
    ? configuredBaseURL
    : resolveLocalFilterestBaseUrl({ applicationRoot: APPLICATION_ROOT });
}

/** Prevents a rejected parallel runner from tearing down another process's active E2E run. */
export function assertArtifactRunOwnedByProcess(
  artifactRun: Pick<CurrentArtifactRun, 'runId' | 'pid' | 'processNonce'>,
  ownerIdentity = getArtifactRegistryProcessIdentity(),
): void {
  if (
    artifactRun.pid !== ownerIdentity.pid
    || artifactRun.processNonce !== ownerIdentity.processNonce
  ) {
    throw new Error(
      `[global-teardown] artifact run ${artifactRun.runId} belongs to another process identity `
      + `(recorded PID ${artifactRun.pid}, teardown PID ${ownerIdentity.pid}). `
      + 'Registry and auth state were not touched.',
    );
  }
}

async function globalTeardown(config: FullConfig) {
  const artifactRun = getCurrentArtifactRun();
  if (!artifactRun) {
    if (fs.existsSync(AUTH_FILE) || fs.existsSync(ARTIFACT_BASELINE_FILE)) {
      throw new Error(
        '[global-teardown] auth or baseline state exists without an exact artifact run registry.',
      );
    }
    return;
  }

  // Playwright invokes configured global teardown even when global setup fails.
  // Keep this gate outside the cleanup try/finally so a rejected parallel runner
  // cannot remove the live owner's shared auth state or mutate its registry.
  assertArtifactRunOwnedByProcess(artifactRun);

  try {
    const baseURL = resolveBaseURL(config);
    if (!fs.existsSync(AUTH_FILE)) {
      throw new Error(
        '[global-teardown] missing authenticated storage state for an active artifact run. ' +
        'No cleanup request was sent.',
      );
    }
    if (!fs.existsSync(ARTIFACT_BASELINE_FILE)) {
      throw new Error(
        '[global-teardown] missing artifact baseline from global setup. ' +
        'Cleanup was not started because no server-side artifact is safe to classify by name alone.',
      );
    }

    // Validate the complete protection set before invoking a helper that can
    // reach any mutating API. Incomplete or legacy baseline files fail closed.
    const baseline = validateSyntheticArtifactBaseline(
      JSON.parse(fs.readFileSync(ARTIFACT_BASELINE_FILE, 'utf8')),
    );
    if (baseline.runId !== artifactRun.runId) {
      throw new Error(
        `[global-teardown] baseline run ${baseline.runId} does not match registry run ` +
        `${artifactRun.runId}. No cleanup request was sent.`,
      );
    }
    if (normalizeE2EBaseURL(baseline.baseURL) !== normalizeE2EBaseURL(baseURL)) {
      throw new Error(
        `[global-teardown] baseline target ${baseline.baseURL} does not match configured target ` +
        `${baseURL}. No cleanup request was sent.`,
      );
    }

    const registeredArtifacts = listRegisteredTestArtifacts(artifactRun.runId);
    const plannedArtifacts = registeredArtifacts.filter((artifact) => artifact.status !== 'confirmed');
    if (plannedArtifacts.length > 0) {
      throw new Error(
        '[global-teardown] ambiguous planned artifacts require inspection; no cleanup request was sent: ' +
        plannedArtifacts.map((artifact) => `${artifact.kind}:${artifact.name}`).join(', '),
      );
    }

    const cleanupSummary = await cleanupSyntheticTestArtifactsWithStorageState(
      baseURL,
      AUTH_FILE,
      baseline,
      registeredArtifacts,
    );

    const deletedCount =
      cleanupSummary.deletedDatasets.length +
      cleanupSummary.deletedFolders.length;
    if (deletedCount > 0) {
      console.log(
        `[global-teardown] cleaned registered E2E artifacts: ` +
        `${cleanupSummary.deletedDatasets.length} datasets, ` +
        `${cleanupSummary.deletedFolders.length} folders`,
      );
    }

    if (
      cleanupSummary.remainingDatasetNames.length > 0 ||
      cleanupSummary.remainingFolderNames.length > 0 ||
      cleanupSummary.remainingSyntheticLangKeys.length > 0
    ) {
      throw new Error(
        '[global-teardown] registered E2E cleanup left artifacts behind: ' +
        `datasets=${cleanupSummary.remainingDatasetNames.join(', ') || 'none'}; ` +
        `folders=${cleanupSummary.remainingFolderNames.join(', ') || 'none'}; ` +
        `lang_keys=${cleanupSummary.remainingSyntheticLangKeys.join(', ') || 'none'}`,
      );
    }

    // Every artifact this run owned is now verified gone, so release the run
    // before the shared language-key comparison. A language-key finding must
    // not leave a stale run record that blocks the next run.
    for (const artifact of registeredArtifacts) {
      unregisterTestArtifact(artifact.kind, artifact.name, artifactRun.runId);
    }
    finishArtifactRunRegistry(artifactRun.runId);
    fs.rmSync(ARTIFACT_BASELINE_FILE, { force: true });

    const langKeyInventory = await readLangKeyInventoryWithStorageState(baseURL, AUTH_FILE);
    const delta = diffSortedKeys(langKeyInventory.allLangKeys, baseline.langKeys);
    if (
      langKeyInventory.totalLangKeyCount !== baseline.totalLangKeyCount ||
      delta.added.length > 0 ||
      delta.removed.length > 0
    ) {
      // The key set is shared with every other session on the same database.
      // Keys a migration file seeds were added by that migration, not by a test.
      const attribution = attributeLangKeyDrift(
        delta.added,
        delta.removed,
        resolveMigrationDirectories(APPLICATION_ROOT),
      );
      const migrationSeeded = describeMigrationSeededKeys(attribution.migrationSeeded);
      if (attribution.unexplainedAdded.length === 0 && attribution.removed.length === 0) {
        console.warn(
          '[global-teardown] language keys were added during the run by database migration(s), '
          + `not by the tests: ${migrationSeeded}`,
        );
      } else {
        throw new Error(
          '[global-teardown] lang-key baseline drifted during E2E run: ' +
          `expected_count=${baseline.totalLangKeyCount}, got_count=${langKeyInventory.totalLangKeyCount}; ` +
          `added=${attribution.unexplainedAdded.join(', ') || 'none'}; ` +
          `removed=${attribution.removed.join(', ') || 'none'}; ` +
          `added_by_migrations=${migrationSeeded}`,
        );
      }
    }
  } finally {
    removeStorageStateFile(AUTH_FILE);
  }
}

export default globalTeardown;
