/**
 * test-artifact-groups.ts
 * Removes registered C17 reader groups through authenticated row APIs.
 * Connects live teardown and dead-run recovery to exact group identities.
 * Verifies known-id cascades and quarantines absent unknown-id evidence without blocking startup.
 */
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { APIRequestContext } from '@playwright/test';
import { confirmTestArtifact, getCurrentArtifactRun, listRegisteredTestArtifacts,
  requireConfirmedTestArtifact, resolveArtifactRegistryRoot, type RegisteredTestArtifact } from './test-artifact-run-registry';
import { fetchCsrfTokenForRequest } from './test-artifact-csrf-reader';
import { requestTestArtifactResponse, readTestArtifactJson, safeTestArtifactError } from './test-artifact-diagnostics';

type Group = { id: number; name: string };
const QUARANTINE_REASON = 'Exact registered group name is absent; serverId was never known; cascade inventories cannot be checked by id.';

/** Publish evidence before releasing ownership; a sibling survives run removal and stays outside startup gates. */
function quarantineAbsentGroup(artifact: RegisteredTestArtifact): string {
  const current = getCurrentArtifactRun();
  if (!current || current.runId !== artifact.runId || artifact.status !== 'planned' || artifact.serverId !== null
    || JSON.stringify(listRegisteredTestArtifacts().find(entry => entry.kind === 'group' && entry.name === artifact.name))
      !== JSON.stringify(artifact)) {
    throw safeTestArtifactError(`Refusing quarantine of changed E2E group evidence: ${JSON.stringify(artifact.name)}`);
  }
  const { isPidActive: _, ...run } = current;
  const directory = `${resolveArtifactRegistryRoot()}-quarantine`;
  const digest = crypto.createHash('sha256').update(`${run.runId}\0${run.processNonce}\0${artifact.name}`).digest('hex');
  const file = path.join(directory, `${digest}.json`);
  const record = { version: 1, run, artifact, quarantinedAt: new Date().toISOString(),
    reason: QUARANTINE_REASON, risk: 'low',
    riskBasis: 'Under the migrated schema, memberships and grants reference system_user_groups.id with ON DELETE CASCADE; a never-existing or deleted group cannot leave referencing rows.',
    schemaEvidence: 'app/server_tools/migrations/20260926000001_restore_system_foreign_keys.sql:37,46,74' };
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = path.join(directory, `.tmp-${process.pid}-${crypto.randomUUID()}`);
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx', mode: 0o600, flush: true });
    try {
      fs.linkSync(temporary, file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      // An interruption after publication retries the same record without losing its first timestamp.
      const existing = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!Number.isFinite(Date.parse(existing.quarantinedAt))
        || JSON.stringify({ ...existing, quarantinedAt: record.quarantinedAt }) !== JSON.stringify(record)) {
        throw safeTestArtifactError(`Conflicting E2E group quarantine evidence at ${file}`);
      }
    }
  } finally {
    fs.rmSync(temporary, { force: true });
  }
  return file;
}

/** The supported group family is deliberately narrower than general dataset names. */
export function validateRegisteredTestGroups(
  artifacts: RegisteredTestArtifact[], runId: string, startedAt: number,
): void {
  const names = new Set<string>(), ids = new Set<number>();
  for (const artifact of artifacts) {
    const match = /^e2e_c17_card_reader_([a-z0-9]+)_([a-z0-9]{6})$/.exec(artifact.name);
    const time = match ? Number.parseInt(match[1], 36) : NaN;
    if (artifact.kind !== 'group' || artifact.runId !== runId || artifact.name.length > 63
      || !match || !Number.isSafeInteger(time) || time.toString(36) !== match[1]
      || !Number.isFinite(startedAt) || time < startedAt || time > 8.64e15
      || !['planned', 'confirmed'].includes(artifact.status)
      || (artifact.status === 'planned' ? artifact.serverId !== null
        : !Number.isSafeInteger(artifact.serverId) || artifact.serverId! <= 0)
      || names.has(artifact.name) || (artifact.serverId !== null && ids.has(artifact.serverId))) {
      throw safeTestArtifactError(`Refusing unproven registered E2E group ${JSON.stringify(artifact.name)}`);
    }
    names.add(artifact.name);
    if (artifact.serverId !== null) ids.add(artifact.serverId);
  }
}

async function readRows(
  request: APIRequestContext, dataset: string, column: string, value: string | number,
): Promise<Array<Record<string, unknown>>> {
  const query = new URLSearchParams({ dataset, view_key: 'table', row_count: '2',
    [`${column}_from`]: String(value), [`${column}_to`]: String(value) });
  const operation = `GET /api/get-results (${dataset})`;
  const response = await requestTestArtifactResponse(operation, () => request.get(`/api/get-results?${query}`));
  const payload = await readTestArtifactJson<{ data?: Array<Record<string, unknown>> }>(response, operation);
  if (!Array.isArray(payload?.data) || payload.data.some(row => !row || row[column] !== value)) {
    throw safeTestArtifactError(`Malformed exact E2E group inventory: ${dataset}`);
  }
  return payload.data;
}

/** Query both identities: absence by name must never hide a renamed recorded id. */
export async function readRegisteredTestGroup(
  request: APIRequestContext, artifact: RegisteredTestArtifact,
): Promise<Group | null> {
  const byName = await readRows(request, 'system_user_groups', 'name', artifact.name);
  const byId = artifact.serverId === null ? byName
    : await readRows(request, 'system_user_groups', 'id', artifact.serverId);
  if (byName.length > 1 || byId.length > 1
    || (byName.length && (!Number.isSafeInteger(byName[0].id) || Number(byName[0].id) <= 0))
    || (byId.length && byId[0].name !== artifact.name)
    || (artifact.serverId !== null && byName.length && byName[0].id !== artifact.serverId)
    || byName.length !== byId.length) {
    throw safeTestArtifactError(`Refusing changed E2E group identity ${JSON.stringify(artifact.name)} serverId=${artifact.serverId ?? 'unknown'}`);
  }
  return byName[0] as Group ?? null;
}

async function assertGroupAbsent(request: APIRequestContext, artifact: RegisteredTestArtifact): Promise<void> {
  if (await readRegisteredTestGroup(request, artifact)) {
    throw safeTestArtifactError(`E2E group remains after deletion: ${JSON.stringify(artifact.name)}`);
  }
  // Unknown-id name absence needs durable quarantine, never an invented cascade proof.
  if (artifact.serverId === null) return;
  for (const [dataset, column] of [['system_user_group_memberships', 'group_id'],
    ['system_group_table_func_rights', 'user_group_id']]) {
    if ((await readRows(request, dataset, column, artifact.serverId)).length) {
      throw safeTestArtifactError(`E2E group cascade left ${dataset}: ${JSON.stringify(artifact.name)}`);
    }
  }
}

/** Caller validates run/target/authentication; release follows cascade proof or durable quarantine. */
export async function cleanupRegisteredTestGroups(
  request: APIRequestContext, artifacts: RegisteredTestArtifact[],
  onReleased?: (artifact: RegisteredTestArtifact, outcome?: 'quarantined') => void,
  beforeDelete: () => void | Promise<void> = () => {},
  log: (line: string) => void = console.warn,
): Promise<string[]> {
  // Preflight every identity before deleting any group. A planned record covers
  // a committed creation whose response/readback was interrupted or timed out.
  const candidates = [];
  for (const artifact of artifacts) {
    const current = await readRegisteredTestGroup(request, artifact);
    if (current && artifact.serverId === null) {
      await beforeDelete();
      // Persist before deletion can erase the only way to recover this id.
      // Update the shared record too: stale recovery checks it against disk.
      confirmTestArtifact('group', artifact.name, current.id);
      Object.assign(artifact, requireConfirmedTestArtifact('group', artifact.name, current.id));
    }
    candidates.push({ artifact, current });
  }
  const removed: string[] = [];
  for (const { artifact, current } of candidates) {
    if (current) {
      const csrf = await fetchCsrfTokenForRequest(request, { name: artifact.name, serverId: artifact.serverId });
      if (!await readRegisteredTestGroup(request, artifact)) {
        throw safeTestArtifactError(`E2E group disappeared before deletion: ${JSON.stringify(artifact.name)}`);
      }
      await beforeDelete();
      // The system foreign keys cascade this one owned group's memberships and grants.
      const operation = 'POST /api/delete-rows?dataset=system_user_groups';
      await requestTestArtifactResponse(operation, () => request.post('/api/delete-rows?dataset=system_user_groups', {
        data: { ids: [artifact.serverId] }, headers: { 'X-CSRF-Token': csrf },
      }), { name: artifact.name, serverId: artifact.serverId });
    }
    if (artifact.serverId === null) await beforeDelete();
    await assertGroupAbsent(request, artifact);
    if (artifact.serverId === null) {
      const file = quarantineAbsentGroup(artifact);
      log(`[E2E group cleanup] WARNING QUARANTINED group=${JSON.stringify(artifact.name)} run=${artifact.runId} serverId=unknown; ${QUARANTINE_REASON} low-risk under migrated cascading foreign keys; inspect=${file}`);
      onReleased?.(artifact, 'quarantined');
    } else {
      onReleased?.(artifact);
      removed.push(artifact.name);
    }
  }
  return removed;
}
