/**
 * test-artifact-stale-run-recovery.ts
 * Recovers recorded datasets before publishing the next E2E artifact run.
 * Bridges fail-closed registry inspection and authenticated application APIs.
 * Removes dead-run leftovers without granting deletion authority to name prefixes.
 */
import type { APIRequestContext } from '@playwright/test';
import { safeTestArtifactError, safeTestArtifactFailure, requestTestArtifactResponse } from './test-artifact-diagnostics';
import {
  finishArtifactRunRegistry,
  getCurrentArtifactRun,
  initializeArtifactRunRegistry,
  listArtifactRunDirectoryIds,
  listRegisteredTestArtifacts,
  resolveArtifactRegistryRoot,
  unregisterTestArtifact,
  type CurrentArtifactRun,
  type InitializeArtifactRunRegistryOptions,
  type RegisteredTestArtifact,
} from './test-artifact-run-registry';
import {
  isArtifactRegistryProcessActive,
  withArtifactRunStartupLock,
} from './test-artifact-startup-lock';
import { readDatasetIdentityFromRequest } from './test-artifact-dataset-identity-reader';
import { assertAuthenticatedCleanupIdentity } from './test-artifact-cleanup';
import { fetchCsrfTokenForRequest } from './test-artifact-csrf-reader';
import { assertArtifactRunTarget, validateArtifactRunTarget, type ArtifactRunTarget } from './test-artifact-run-target';

type RecoverArtifacts = (
  run: CurrentArtifactRun,
  artifacts: RegisteredTestArtifact[],
  assertStillDead: () => void,
) => Promise<void>;

/**
 * Reserves startup before inspecting the dead owner and all recorded worker PIDs.
 * Ordinary initialization retains its synchronous registry semantics; unsafe
 * stale state is validated in full before login or any destructive API call.
 */
export async function initializeArtifactRunRegistryWithRecovery(
  options: InitializeArtifactRunRegistryOptions,
  recoverArtifacts: RecoverArtifacts,
  readNewTarget?: () => Promise<ArtifactRunTarget>,
): Promise<CurrentArtifactRun> {
  const registryRoot = resolveArtifactRegistryRoot(options.rootDirectory);
  const readTarget = async () => {
    try { return readNewTarget ? await readNewTarget() : options.target; } catch (error) {
      throw safeTestArtifactFailure(error, 'read new run target');
    }
  };
  try {
    return await withArtifactRunStartupLock(registryRoot, async () => {
      const deadRun = getCurrentArtifactRun({ rootDirectory: registryRoot });
      if (deadRun?.isPidActive) return initializeArtifactRunRegistry(options);
      if (!deadRun) {
        if (listArtifactRunDirectoryIds(registryRoot).length > 0) {
          throw safeTestArtifactError('Unfinished E2E artifact run directories require explicit inspection');
        }
        return initializeArtifactRunRegistry({ ...options,
          ...(readNewTarget ? { target: await readTarget() } : {}) });
      }
      const refusal = `Stale E2E artifact run ${deadRun.runId} from dead PID ${deadRun.pid}`;
      try {
        const directories = listArtifactRunDirectoryIds(registryRoot);
        if (directories.length !== 1 || directories[0] !== deadRun.runId) {
          throw safeTestArtifactError(`Unfinished or foreign run directories: ${directories.join(', ')}`);
        }
        const artifacts = listRegisteredTestArtifacts(deadRun.runId);
        const assertStillDead = () => {
          const current = getCurrentArtifactRun({ rootDirectory: registryRoot });
          if (!current || current.runId !== deadRun.runId || current.pid !== deadRun.pid
            || current.processNonce !== deadRun.processNonce || current.startedAt !== deadRun.startedAt
            || JSON.stringify(current.target) !== JSON.stringify(deadRun.target)) {
            throw safeTestArtifactError('The dead run process identity changed during recovery');
          }
          if (current.isPidActive) throw safeTestArtifactError(`Run owner PID ${current.pid} is live`);
          if (JSON.stringify(listRegisteredTestArtifacts(deadRun.runId)) !== JSON.stringify(artifacts)) {
            throw safeTestArtifactError('Recorded artifacts changed during recovery; preserving the dead run');
          }
          for (const artifact of artifacts) {
            if (isArtifactRegistryProcessActive(artifact.registeredByPid)) {
              throw safeTestArtifactError(`${artifact.kind} ${JSON.stringify(artifact.name)}: recording worker PID ${artifact.registeredByPid} is live`);
            }
          }
        };
        assertStillDead();
        for (const artifact of artifacts) {
          if (artifact.kind !== 'dataset') {
            throw safeTestArtifactError(`${artifact.kind} ${JSON.stringify(artifact.name)}: automatic stale recovery supports datasets only`);
          }
        }
        validateArtifactRunTarget(deadRun.target);
        // Obtain the new descriptor's target while all old evidence is still intact.
        // The recovery callback independently validates it against the dead run.
        const target = await readTarget();
        await recoverArtifacts(deadRun, artifacts, assertStillDead);
        assertStillDead();
        // Preserve all records until every artifact has a safe outcome. If a
        // previous drop succeeded but a later one failed, the next attempt sees
        // that first dataset as already absent and can safely continue.
        for (const artifact of artifacts) {
          unregisterTestArtifact(artifact.kind, artifact.name, deadRun.runId);
        }
        finishArtifactRunRegistry(deadRun.runId);
        return initializeArtifactRunRegistry({ ...options, target });
      } catch (error) {
        throw safeTestArtifactError(`${refusal} refuses automatic recovery: ${safeTestArtifactFailure(error, 'recover stale run').message}`);
      }
    });
  } catch (error) {
    throw safeTestArtifactFailure(error, 'initialize artifact run');
  }
}

/**
 * Uses the freshly authenticated test administrator's request context and CSRF.
 * Confirmed records require exact name/UID; planned records need the generated
 * name's process timestamp at or after run start, never database clock evidence.
 */
export async function recoverStaleRunDatasets(
  request: APIRequestContext,
  identity: { userId: number; username: string; baseURL: string },
  deadRun: CurrentArtifactRun,
  artifacts: RegisteredTestArtifact[],
  assertStillDead: () => void,
  log: (line: string) => void = console.log,
): Promise<void> {
  try {
    await assertAuthenticatedCleanupIdentity(request, identity);
    await assertArtifactRunTarget(request, identity.baseURL, deadRun.target);
    const startedAt = Date.parse(deadRun.startedAt);
    const readCandidate = async (artifact: RegisteredTestArtifact) => {
      const current = await readDatasetIdentityFromRequest(request, artifact.name,
        artifact.status === 'confirmed' ? artifact.serverId! : undefined);
      if (current && artifact.status === 'confirmed' && current.tableUID !== artifact.serverId) {
        throw safeTestArtifactError(`server-id mismatch: recorded=${artifact.serverId}, current=${current.tableUID}`);
      }
      return current;
    };
    const candidates = [];
    // Validate every artifact before the first drop, including those encountered
    // later in reverse creation order (dependent datasets are removed first).
    for (const artifact of [...artifacts].reverse()) {
      try {
        assertStillDead();
        candidates.push({ artifact, current: await readCandidate(artifact) });
      } catch (error) {
        throw safeTestArtifactFailure(error, 'recover dataset', { name: artifact.name, serverId: artifact.serverId });
      }
    }
    for (const { artifact, current: initial } of candidates) {
      let serverId = initial?.tableUID ?? artifact.serverId;
      try {
        assertStillDead();
        const current = await readCandidate(artifact);
        serverId = current?.tableUID ?? serverId;
        let outcome = 'already absent';
        if (current) {
          if (!initial || initial.tableUID !== current.tableUID) {
            throw safeTestArtifactError('dataset identity changed during recovery');
          }
          if (artifact.status === 'planned'
            && !plannedNameProvesOwnership(artifact.name, startedAt)) {
            outcome = 'skipped: generated name at or after run start not proven';
          } else {
            const csrfToken = await fetchCsrfTokenForRequest(request, { name: artifact.name, serverId: artifact.serverId });
            // Read again after CSRF acquisition, immediately before the name-only API.
            const latest = await readCandidate(artifact);
            if (!latest || latest.tableUID !== current.tableUID) {
              throw safeTestArtifactError('dataset identity changed immediately before drop');
            }
            await assertArtifactRunTarget(request, identity.baseURL, deadRun.target);
            assertStillDead();
            await requestTestArtifactResponse('POST /api/drop-dataset', () => request.post('/api/drop-dataset', {
              data: { dataset_name: artifact.name, confirm_dataset_name: artifact.name },
              headers: { 'X-CSRF-Token': csrfToken },
            }), { name: artifact.name, serverId: artifact.serverId });
            if (await readCandidate(artifact)) throw safeTestArtifactError('drop reported success but dataset remains');
            outcome = 'dropped';
          }
        }
        log(`[E2E recovery] dataset=${JSON.stringify(artifact.name)} serverId=${serverId ?? 'unknown'} outcome=${outcome}`);
      } catch (error) {
        throw safeTestArtifactFailure(error, 'recover dataset', { name: artifact.name, serverId: artifact.serverId });
      }
    }
    // Even an all-absent or skipped run must still belong to this installation
    // when its evidence is released and the next run's baseline is published.
    await assertArtifactRunTarget(request, identity.baseURL, deadRun.target);
  } catch (error) {
    throw safeTestArtifactFailure(error, 'recover stale datasets');
  }
}

/** Matches buildTempDatasetName's prefix/base36 milliseconds/random suffix contract. */
function plannedNameProvesOwnership(name: string, startedAt: number): boolean {
  if (name.length > 63) return false;
  const match = /^([a-z0-9](?:[a-z0-9_]*[a-z0-9])?)_([a-z0-9]+)_([a-z0-9]{6})$/.exec(name);
  if (!match) return false;
  const embeddedTime = Number.parseInt(match[2], 36);
  return Number.isSafeInteger(embeddedTime) && embeddedTime.toString(36) === match[2]
    && embeddedTime >= startedAt && embeddedTime <= 8.64e15;
}
