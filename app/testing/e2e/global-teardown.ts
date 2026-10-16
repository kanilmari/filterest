// global-teardown.ts
// Removes owned datasets/folders and reports retained language keys after the test suite.
// Bridges authenticated API cleanup with registry ownership and nightly retention evidence.
// Keeps ownership history on failure and reports every cleanup/evidence failure.

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
  resolveArtifactRegistryRoot,
  unregisterTestArtifact,
  type CurrentArtifactRun,
  type RegisteredTestArtifact,
} from './helpers/test-artifact-run-registry';
import { isOwnRunDatasetKey, ownRunDatasetForKey } from './helpers/lang-key-drift-attribution';
import { attributeRecordedLangKeyDrift, bareColumnForKey, bareColumnKeyEvidence } from './helpers/bare-column-key-attribution';
import { readRecordedColumnKeySources } from './helpers/test-artifact-column-key-sources';
import { readRecordedDatasetColumns } from './helpers/test-artifact-dataset-columns';
import { readLangKeySourcesWithStorageState } from './helpers/lang-key-source-inventory';
import { readCompletedDatasetNames } from './helpers/test-artifact-dataset-history';
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

  let teardownFailed = false;
  let reportFinalizationFailure: ((stage: string) => boolean) | undefined;
  try {
    let baseURL: string | null = null;
    let status = 'incomplete: target resolution failed';
    let retainedOwnRunLangKeys: string[] = [];
    let unverifiedOwnRunLangKeys: string[] = [];
    let ownRunLangKeyCandidates: string[] = [];
    let retainedOwnRunLangKeyEvidence: Array<{ key: string; dataset: string; column?: string;
      ownership: string; countingSources: string } | NonNullable<ReturnType<typeof bareColumnKeyEvidence>>> = [];
    let unexplainedAddedLangKeys: string[] = [];
    let removedLangKeys: string[] = [];
    let cleanupStarted = false;
    try {
      // Protect every owned-run read, including a missing or unreadable baseline.
      // Fixed stage names report the reason without exposing private parser/transport data.
      baseURL = resolveBaseURL(config);
      status = 'incomplete: authenticated storage state validation failed';
      if (!fs.existsSync(AUTH_FILE)) {
        throw new Error(
          '[global-teardown] missing authenticated storage state for an active artifact run. ' +
          'No cleanup request was sent.',
        );
      }
      status = 'incomplete: artifact baseline validation failed';
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

      status = 'incomplete: artifact registry validation failed';
      const registeredArtifacts = listRegisteredTestArtifacts(artifactRun.runId);
      status = 'incomplete: planned artifact validation failed';
      const plannedArtifacts = registeredArtifacts.filter((artifact) => artifact.status !== 'confirmed');
      if (plannedArtifacts.length > 0) {
        throw new Error(
          '[global-teardown] ambiguous planned artifacts require inspection; no cleanup request was sent: ' +
          plannedArtifacts.map((artifact) => `${artifact.kind}:${artifact.name}`).join(', '),
        );
      }
      // Per-test drops unregister their active entries. Preserve their confirmed
      // history as well as datasets still registered when teardown starts.
      status = 'incomplete: completed dataset history read failed';
      const runDirectory = path.join(resolveArtifactRegistryRoot(), artifactRun.runId);
      const completedDatasetNames = new Set(readCompletedDatasetNames(runDirectory, artifactRun.runId));
      const ownDatasetNames = Array.from(new Set([
        ...completedDatasetNames,
        ...registeredArtifacts.filter(artifact => artifact.kind === 'dataset').map(artifact => artifact.name),
      ]));
      status = 'incomplete: dataset column history read failed';
      const columnsByDataset = readRecordedDatasetColumns(runDirectory, artifactRun.runId, ownDatasetNames);
      status = 'incomplete: pre-drop column-key source history read failed';
      const preDropSources = readRecordedColumnKeySources(runDirectory, artifactRun.runId, ownDatasetNames, columnsByDataset);

      const releasedArtifacts = new Set<string>();
      const releaseConfirmedArtifact = (artifact: RegisteredTestArtifact) => {
        const key = `${artifact.kind}\0${artifact.name}`;
        if (releasedArtifacts.has(key)) return;
        unregisterTestArtifact(artifact.kind, artifact.name, artifactRun.runId);
        if (artifact.kind === 'dataset') completedDatasetNames.add(artifact.name);
        releasedArtifacts.add(key);
      };
      status = 'incomplete: artifact cleanup failed';
      cleanupStarted = true;
      // Cleanup also reads the language-key inventory, even with no active artifacts.
      // Protect it from the first await so those failures produce retention evidence too.
      const cleanupSummary = await cleanupSyntheticTestArtifactsWithStorageState(
        baseURL,
        AUTH_FILE,
        baseline,
        registeredArtifacts,
        releaseConfirmedArtifact,
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
        cleanupSummary.remainingFolderNames.length > 0
      ) {
        throw new Error(
          '[global-teardown] registered E2E cleanup left artifacts behind: ' +
          `datasets=${cleanupSummary.remainingDatasetNames.join(', ') || 'none'}; ` +
          `folders=${cleanupSummary.remainingFolderNames.join(', ') || 'none'}`,
        );
      }

      status = 'incomplete: language-key inventory read failed';
      const langKeyInventory = await readLangKeyInventoryWithStorageState(baseURL, AUTH_FILE);
      const delta = diffSortedKeys(langKeyInventory.allLangKeys, baseline.langKeys);
      ownRunLangKeyCandidates = delta.added.filter(key => isOwnRunDatasetKey(key, ownDatasetNames, columnsByDataset)
        || bareColumnForKey(key, ownDatasetNames, columnsByDataset) !== undefined);
      unverifiedOwnRunLangKeys = ownRunLangKeyCandidates;
      // Use fixed failure reasons: transport/parser messages can contain private response data.
      status = 'incomplete: language-key source read failed';
      const sources = await readLangKeySourcesWithStorageState(baseURL, AUTH_FILE, unverifiedOwnRunLangKeys);
      status = 'incomplete: language-key drift comparison failed';
      const attribution = attributeRecordedLangKeyDrift(delta.added, delta.removed, ownDatasetNames, sources,
        { columnsByDataset, completedDatasetNames }, preDropSources);
      retainedOwnRunLangKeys = attribution.retainedOwnRun;
      unexplainedAddedLangKeys = attribution.unexplainedAdded;
      removedLangKeys = attribution.removed;
      retainedOwnRunLangKeyEvidence = retainedOwnRunLangKeys.map(key => {
        const bareColumn = bareColumnKeyEvidence(key, ownDatasetNames, columnsByDataset, preDropSources);
        if (bareColumn) return bareColumn;
        const dataset = ownRunDatasetForKey(key, ownDatasetNames, columnsByDataset)!;
        const column = columnsByDataset.get(dataset)?.find(name =>
          [name, `search_for_${name}`, `${name}_asc`, `${name}_desc`].includes(key));
        return { key, dataset, ...(column ? { column } : {}),
          ownership: completedDatasetNames.has(dataset) ? 'completed-dataset-history' : 'confirmed-dataset-registry',
          countingSources: sources.get(key)!.length === 0 ? 'complete-empty-inventory-after-drop' : 'verified-own-sources-or-bookkeeping' };
      });
      unverifiedOwnRunLangKeys = [];
      if (
        langKeyInventory.totalLangKeyCount !== baseline.totalLangKeyCount + retainedOwnRunLangKeys.length ||
        attribution.unexplainedAdded.length > 0 || attribution.removed.length > 0
      ) {
        throw new Error(
          '[global-teardown] lang-key baseline drifted during E2E run: ' +
          `expected_count=${baseline.totalLangKeyCount}, got_count=${langKeyInventory.totalLangKeyCount}; ` +
          `added=${attribution.unexplainedAdded.join(', ') || 'none'}; ` +
          `removed=${attribution.removed.join(', ') || 'none'}; ` +
          `retained_own_run_count=${retainedOwnRunLangKeys.length}`,
        );
      }
      status = 'complete';
    } catch (error) {
      // A failed sequence cannot contribute accepted keys to nightly totals.
      // Keep unconfirmed registry entries and history/baseline evidence; propagate this exact failure.
      teardownFailed = true;
      retainedOwnRunLangKeys = [];
      retainedOwnRunLangKeyEvidence = [];
      throw error;
    } finally {
      let reportWritten = false;
      const reportDirectory = path.join(testRuntimePaths.root, 'e2e', 'lang-key-retention');
      const writeReport = (rewrite = false) => {
        const retainedOwnRunLangKeyCount = retainedOwnRunLangKeys.length;
        fs.mkdirSync(reportDirectory, { recursive: true, mode: 0o700 });
        const reportFile = path.join(reportDirectory, `${artifactRun.runId}.json`);
        fs.writeFileSync(reportFile, `${JSON.stringify({ version: 1, runId: artifactRun.runId, baseURL,
          capturedAt: new Date().toISOString(), status, retainedOwnRunLangKeyCount,
          retainedOwnRunLangKeys, unverifiedOwnRunLangKeys, retainedOwnRunLangKeyEvidence,
          unexplainedAddedLangKeys, removedLangKeys }, null, 2)}\n`,
        { flag: rewrite ? 'w' : 'wx', mode: 0o600 });
        console.log(`[global-teardown] retained own-run language keys: count=${retainedOwnRunLangKeyCount}; `
          + `names=${retainedOwnRunLangKeys.join(', ') || 'none'}; status=${status}; `
          + `unverified=${unverifiedOwnRunLangKeys.join(', ') || 'none'}; report=${reportFile}`);
      };
      try {
        writeReport();
        reportWritten = true;
        let rewriteAttempted = false;
        reportFinalizationFailure = (stage) => {
          if (rewriteAttempted) return false;
          rewriteAttempted = true;
          status = `incomplete: ${stage} failed`;
          unverifiedOwnRunLangKeys = ownRunLangKeyCandidates;
          retainedOwnRunLangKeys = [];
          retainedOwnRunLangKeyEvidence = [];
          // A late failure invalidates earlier acceptance. Attempt one replacement,
          // keeping its error secondary to the finalization failure even if writing fails.
          try {
            writeReport(true);
          } catch {
            console.error('[global-teardown] retention report rewrite also failed; original finalization failure was kept.');
          }
          return true;
        };
      } catch (reportError) {
        if (!teardownFailed) throw reportError;
        // Reporting must not replace the original cleanup/read/comparison failure.
        console.error('[global-teardown] retention reporting also failed; ownership evidence was kept.');
      }

      let finalizationStage = 'registry release';
      try {
        // Preflight failure proves no absence, even with no active entries.
        // Keep its current pointer, baseline and history in place; never archive or release it.
        if (cleanupStarted && reportWritten && listRegisteredTestArtifacts(artifactRun.runId).length === 0) {
          if (teardownFailed) {
            // A history-only run directory still blocks startup. Preserve it outside
            // the active registry AFTER reporting, with a baseline copy that the next
            // setup cannot overwrite. Never copy the neighbouring authenticated state.
            finalizationStage = 'evidence archive';
            const evidenceDirectory = path.join(reportDirectory, `${artifactRun.runId}.evidence`);
            fs.mkdirSync(evidenceDirectory, { mode: 0o700 });
            fs.cpSync(path.join(resolveArtifactRegistryRoot(), artifactRun.runId), evidenceDirectory,
              { recursive: true, force: false, errorOnExist: true });
            fs.copyFileSync(ARTIFACT_BASELINE_FILE, path.join(evidenceDirectory, 'artifact-baseline.json'), fs.constants.COPYFILE_EXCL);
          }
          finalizationStage = 'registry release';
          finishArtifactRunRegistry(artifactRun.runId);
          finalizationStage = 'artifact baseline removal';
          if (!teardownFailed) fs.rmSync(ARTIFACT_BASELINE_FILE, { force: true });
        }
      } catch (releaseError) {
        reportFinalizationFailure?.(finalizationStage);
        throw releaseError;
      }
    }
  } catch (error) {
    // A later auth-removal failure must not replace a reporting/release failure.
    teardownFailed = true;
    throw error;
  } finally {
    try {
      removeStorageStateFile(AUTH_FILE);
    } catch (authError) {
      if (reportFinalizationFailure?.('auth-state removal') || !teardownFailed) throw authError;
      console.error('[global-teardown] auth-state removal also failed; original teardown failure was kept.');
    }
  }
}

export default globalTeardown;
