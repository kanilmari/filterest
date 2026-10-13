/**
 * test-artifact-recovery-fakes.ts
 * Shares fake administrator APIs and temporary registries across recovery regressions.
 * Connects real ownership orchestration with failures injected without sockets.
 * Keeps the recovery and diagnostic suites on the same server-contract fixtures.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, expect, vi } from 'vitest';
import type { APIRequestContext } from '@playwright/test';
import {
  confirmTestArtifact, getCurrentArtifactRun, initializeArtifactRunRegistry,
  registerTestArtifact,
} from './test-artifact-run-registry';
import { initializeArtifactRunRegistryWithRecovery, recoverStaleRunDatasets } from './test-artifact-stale-run-recovery';
import { treeResponseForDatasets } from './test-artifact-tree-fixture';

export const DEAD_PID = 919191;
export const DEAD_WORKER = 919192;
export const RUN_ID = 'run-dead-recovery';
export const START = '2026-10-11T12:00:00.000Z';
export const CREATED = '2026-10-11T12:00:01.000Z';
export const TARGET = { baseURL: 'https://original.invalid', databaseId: 'a'.repeat(32) };
export const plannedName = (time = Date.parse(START) + 1) => `e2e_planned_${time.toString(36)}_abc123`;
export let root: string;
export let livePids: Set<number>;
export type Dataset = { uid: number; created?: string | null };

export function response(payload: unknown, status = 200) {
  return { ok: () => status >= 200 && status < 300, status: () => status,
    json: async () => payload, text: async () => JSON.stringify(payload) };
}

export function fakeApi(datasets: Record<string, Dataset> = {}) {
  const state = { dropStatus: 200, keepOnDrop: false, metadataStatus: 200,
    absentMetadataStatus: 403, databaseId: TARGET.databaseId, inventoryStatus: 200,
    profile: { user_id: 4, username: 'test_admin' },
    onCsrf: () => {}, onMetadata: (_name: string) => {} };
  const get = vi.fn(async (url: string, options?: { params?: { dataset?: string } }) => {
    if (url === '/api/user-profile') return response(state.profile);
    // Synthetic application version keeps recovery independent of the release cut.
    if (url === '/api/admin/version-info') return response({ app_version: '9.3.24', db_version: '9.11.0' });
    if (url === '/api/get-results') return response({ row_count: 1,
      data: [{ singleton_key: true, database_id: state.databaseId }] });
    if (url === '/api/csrf-token') {
      state.onCsrf();
      return response({ csrf_token: 'fake-csrf' });
    }
    if (url === '/api/get-metadata') {
      const name = options?.params?.dataset ?? '';
      state.onMetadata(name);
      const dataset = datasets[name];
      return response({ data: dataset ? [{ table_name: name, table_uid: dataset.uid,
        schema_name: 'public', created: dataset.created }] : [] }, dataset ? state.metadataStatus : state.absentMetadataStatus);
    }
    if (url === '/api/tree_data') return response(treeResponseForDatasets(datasets));
    if (url === '/api/datasets') return response({ datasets: Object.keys(datasets)
      .map((dataset_name) => ({ dataset_name, table_uid: datasets[dataset_name].uid })) }, state.inventoryStatus);
    throw new Error(`Unexpected GET ${url}`);
  });
  const post = vi.fn(async (url: string, options: { data: { dataset_name: string } }) => {
    expect(url).toBe('/api/drop-dataset');
    if (state.dropStatus === 200 && !state.keepOnDrop) delete datasets[options.data.dataset_name];
    return response({ message: state.dropStatus === 200 ? 'dropped' : 'policy-lock timeout: does not exist' }, state.dropStatus);
  });
  return { request: { get, post } as unknown as APIRequestContext, get, post, datasets, state };
}

export function seedArtifact(name = 'e2e_recorded', status: 'confirmed' | 'planned' = 'confirmed', uid = 919) {
  if (!fs.existsSync(path.join(root, 'current-run.json'))) {
    initializeArtifactRunRegistry({ rootDirectory: root, runId: RUN_ID, pid: DEAD_PID, now: new Date(START), target: TARGET });
  }
  registerTestArtifact('dataset', name);
  if (status === 'confirmed') confirmTestArtifact('dataset', name, uid);
  const directory = path.join(root, RUN_ID, 'artifacts', 'dataset');
  for (const entry of fs.readdirSync(directory)) {
    const file = path.join(directory, entry);
    const artifact = JSON.parse(fs.readFileSync(file, 'utf8'));
    artifact.registeredByPid = DEAD_WORKER;
    fs.writeFileSync(file, JSON.stringify(artifact));
  }
}

export async function recover(api = fakeApi(), log = vi.fn()) {
  const run = await initializeArtifactRunRegistryWithRecovery({ rootDirectory: root, runId: 'run-new-recovery' },
    (deadRun, artifacts, assertStillDead) => recoverStaleRunDatasets(api.request,
      { userId: 4, username: 'test_admin', baseURL: TARGET.baseURL }, deadRun, artifacts, assertStillDead, log));
  return { run, log };
}

export function expectDeadRecordKept() {
  expect(getCurrentArtifactRun({ rootDirectory: root })?.runId).toBe(RUN_ID);
  expect(fs.existsSync(path.join(root, RUN_ID))).toBe(true);
}

/** Installs a private temporary registry and fake liveness checks for each test. */
export function useRecoveryRegistry() {
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'filterest-stale-recovery-'));
    livePids = new Set([process.pid]);
    vi.spyOn(process, 'kill').mockImplementation((pid) => {
      if (livePids.has(pid)) return true;
      throw Object.assign(new Error('dead'), { code: 'ESRCH' });
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(`${root}.startup-lock`, { recursive: true, force: true });
  });

}
