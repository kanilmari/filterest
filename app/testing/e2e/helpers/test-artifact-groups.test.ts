/**
 * test-artifact-groups.test.ts
 * Proves C17 group cleanup across failed setup, teardown and dead-run recovery.
 * Connects real temporary registry records to fake row APIs without a browser/database.
 * Protects other groups and keeps evidence until the group and both cascade targets disappear.
 */
// @vitest-environment node
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanupSyntheticTestArtifacts, type SyntheticArtifactBaseline } from './test-artifact-cleanup';
import { validateRegisteredTestGroups } from './test-artifact-groups';
import {
  confirmTestArtifact, finishArtifactRunRegistry, getCurrentArtifactRun,
  initializeArtifactRunRegistry, listRegisteredTestArtifacts,
  registerTestArtifact, unregisterTestArtifact, type RegisteredTestArtifact,
} from './test-artifact-run-registry';
import {
  DEAD_PID, DEAD_WORKER, RUN_ID, START, TARGET, root, fakeApi, response,
  recover, expectDeadRecordKept, useRecoveryRegistry,
} from './test-artifact-recovery-fakes';

useRecoveryRegistry();
afterEach(() => fs.rmSync(`${root}-quarantine`, { recursive: true, force: true }));
const name = `e2e_c17_card_reader_${(Date.parse(START) + 100).toString(36)}_abc123`;
const other = `${name}_unregistered`;
const baseline: SyntheticArtifactBaseline = {
  runId: RUN_ID, baseURL: TARGET.baseURL, userId: 4, username: 'test_admin',
  datasets: [], folders: [], langKeys: [], totalLangKeyCount: 0, capturedAt: START,
};

function artifact(status: 'confirmed' | 'planned' = 'confirmed'): RegisteredTestArtifact {
  return { version: 1, runId: RUN_ID, kind: 'group', name, status,
    serverId: status === 'confirmed' ? 919 : null, registeredAt: START,
    registeredByPid: DEAD_WORKER, confirmedAt: status === 'confirmed' ? START : null };
}

function groupApi(present = true) {
  const api = fakeApi();
  const groups = present ? [{ id: 919, name }, { id: 920, name: other }, { id: 921, name: 'users' }]
    : [{ id: 920, name: other }, { id: 921, name: 'users' }];
  const memberships = present ? [{ id: 11, group_id: 919, user_id: 7 }] : [];
  const grants = present ? [{ id: 12, user_group_id: 919, function_id: 8 }] : [];
  const state = { deleteStatus: 200, keepGroup: false, keepChildren: false, badRead: false,
    onDelete: () => {} };
  const originalGet = api.get.getMockImplementation()!;
  api.get.mockImplementation(async (url, options) => {
    if (url === '/api/translations?lang=en') return response({});
    if (url.startsWith('/api/get-results?')) {
      if (state.badRead) return response({ data: null });
      const params = new URL(url, TARGET.baseURL).searchParams;
      const dataset = params.get('dataset');
      const rows = dataset === 'system_user_groups' ? groups
        : dataset === 'system_user_group_memberships' ? memberships : grants;
      const field = [...params.keys()].find(key => key.endsWith('_from'))!.slice(0, -5);
      const value = params.get(`${field}_from`);
      expect(params.get(`${field}_to`)).toBe(value);
      return response({ data: rows.filter(row => String((row as Record<string, unknown>)[field]) === value) });
    }
    return originalGet(url, options);
  });
  api.post.mockImplementation(async (url, options) => {
    expect(url).toBe('/api/delete-rows?dataset=system_user_groups');
    expect(options.data).toEqual({ ids: [919] });
    state.onDelete();
    if (state.deleteStatus === 200) {
      if (!state.keepGroup) groups.splice(groups.findIndex(group => group.id === 919), 1);
      if (!state.keepChildren) { memberships.length = 0; grants.length = 0; }
    }
    return response({}, state.deleteStatus);
  });
  return { ...api, groups, memberships, grants, groupState: state };
}

function seedGroup(status: 'confirmed' | 'planned' = 'confirmed') {
  initializeArtifactRunRegistry({ rootDirectory: root, runId: RUN_ID,
    pid: DEAD_PID, now: new Date(START), target: TARGET });
  registerTestArtifact('group', name);
  if (status === 'confirmed') confirmTestArtifact('group', name, 919);
  const directory = path.join(root, RUN_ID, 'artifacts', 'group');
  const file = path.join(directory, fs.readdirSync(directory)[0]);
  const record = JSON.parse(fs.readFileSync(file, 'utf8'));
  record.registeredByPid = DEAD_WORKER;
  fs.writeFileSync(file, JSON.stringify(record));
}

describe('registered C17 group cleanup', () => {
  test.each(['full setup', 'before membership', 'before grants'])
  ('teardown removes a confirmed group and its children after setup stopped at %s', async stage => {
    seedGroup();
    const api = groupApi();
    if (stage !== 'full setup') api.memberships.length = 0;
    if (stage === 'before grants') api.grants.length = 0;
    const release = vi.fn((entry: RegisteredTestArtifact) => unregisterTestArtifact(entry.kind, entry.name));
    const summary = await cleanupSyntheticTestArtifacts(api.request, baseline, listRegisteredTestArtifacts(), release);
    expect(summary.deletedGroups).toEqual([name]);
    expect(api.groups).toEqual([{ id: 920, name: other }, { id: 921, name: 'users' }]);
    expect(api.memberships).toEqual([]);
    expect(api.grants).toEqual([]);
    expect(release).toHaveBeenCalledOnce();
    expect(listRegisteredTestArtifacts()).toEqual([]);
  });

  test('a committed creation with a lost response/readback is cleaned from its planned record', async () => {
    seedGroup('planned');
    const api = groupApi();
    await cleanupSyntheticTestArtifacts(api.request, baseline, listRegisteredTestArtifacts(),
      entry => unregisterTestArtifact(entry.kind, entry.name));
    expect(api.post).toHaveBeenCalledOnce();
    expect(api.memberships).toEqual([]);
    expect(api.grants).toEqual([]);
    expect(listRegisteredTestArtifacts()).toEqual([]);
  });

  test('an absent confirmed group needs no deletion', async () => {
    const api = groupApi(false);
    const release = vi.fn();
    await cleanupSyntheticTestArtifacts(api.request, baseline, [artifact()], release);
    expect(api.post).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledExactlyOnceWith(artifact());
  });

  test.each(['teardown', 'stale-run recovery'] as const)
  ('%s quarantines a pre-send interruption and allows later runs to start', async mode => {
    seedGroup('planned');
    const api = groupApi(false);
    const original = listRegisteredTestArtifacts()[0];
    const originalRun = getCurrentArtifactRun();
    const log = vi.fn();
    vi.spyOn(console, 'warn').mockImplementation(log);
    const quarantineDirectory = `${root}-quarantine`;
    const readQuarantine = () => {
      const files = fs.readdirSync(quarantineDirectory);
      expect(files).toHaveLength(1);
      return { file: path.join(quarantineDirectory, files[0]),
        record: JSON.parse(fs.readFileSync(path.join(quarantineDirectory, files[0]), 'utf8')) };
    };
    const release = vi.fn((entry: RegisteredTestArtifact) => {
      // The durable copy must exist before ownership is removed, even if interrupted here.
      expect(readQuarantine().record.artifact).toEqual(original);
      unregisterTestArtifact(entry.kind, entry.name);
    });
    if (mode === 'teardown') {
      const summary = await cleanupSyntheticTestArtifacts(api.request, baseline, listRegisteredTestArtifacts(), release);
      expect(summary.deletedGroups).toEqual([]);
      expect(release).toHaveBeenCalledOnce();
      finishArtifactRunRegistry(RUN_ID);
      expect(fs.readdirSync(root)).toEqual([]);
      await recover(api);
    } else {
      await recover(api, log);
    }
    expect(getCurrentArtifactRun()?.runId).toBe('run-new-recovery');
    expect(fs.existsSync(path.join(root, RUN_ID))).toBe(false);
    expect(listRegisteredTestArtifacts()).toEqual([]);
    const { file, record } = readQuarantine();
    expect(record).toMatchObject({ version: 1, artifact: original,
      run: { runId: RUN_ID, pid: DEAD_PID, processNonce: originalRun!.processNonce,
        startedAt: START, target: TARGET }, risk: 'low',
      reason: 'Exact registered group name is absent; serverId was never known; cascade inventories cannot be checked by id.' });
    expect(Number.isFinite(Date.parse(record.quarantinedAt))).toBe(true);
    const report = log.mock.calls.map(([line]) => line).join('\n');
    for (const detail of ['QUARANTINED', name, RUN_ID, 'serverId=unknown', 'low-risk', record.reason, file]) {
      expect(report).toContain(detail);
    }
    expect(report).not.toContain('outcome=removed or already absent');
    // Finishing another run cannot erase quarantine or turn it into a startup blocker.
    finishArtifactRunRegistry('run-new-recovery');
    expect(fs.readdirSync(root)).toEqual([]);
    await recover(api);
    expect(readQuarantine()).toEqual({ file, record });
    expect(api.post).not.toHaveBeenCalled();
  });

  test('failed quarantine persistence keeps ownership; retry archives before releasing', async () => {
    seedGroup('planned');
    const api = groupApi(false);
    const release = vi.fn((entry: RegisteredTestArtifact) => unregisterTestArtifact(entry.kind, entry.name));
    fs.writeFileSync(`${root}-quarantine`, 'blocked archive directory');
    const attempt = () => cleanupSyntheticTestArtifacts(api.request, baseline, listRegisteredTestArtifacts(), release);
    await expect(attempt()).rejects.toThrow();
    expectDeadRecordKept();
    expect(release).not.toHaveBeenCalled();
    fs.unlinkSync(`${root}-quarantine`);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await attempt();
    expect(listRegisteredTestArtifacts()).toEqual([]);
    expect(fs.readdirSync(`${root}-quarantine`)).toHaveLength(1);
    expect(api.post).not.toHaveBeenCalled();
  });

  test('an interruption after publication keeps one durable quarantine record on retry', async () => {
    seedGroup('planned');
    const api = groupApi(false);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(cleanupSyntheticTestArtifacts(api.request, baseline, listRegisteredTestArtifacts(), () => {
      throw new Error('interrupted before release');
    })).rejects.toThrow('interrupted before release');
    const directory = `${root}-quarantine`;
    const file = path.join(directory, fs.readdirSync(directory)[0]);
    const first = fs.readFileSync(file, 'utf8');
    expectDeadRecordKept();
    await recover(api);
    expect(fs.readdirSync(directory)).toHaveLength(1);
    expect(fs.readFileSync(file, 'utf8')).toBe(first);
    expect(listRegisteredTestArtifacts()).toEqual([]);
  });

  test.each(['teardown', 'stale-run recovery'] as const)
  ('%s persists a recovered id before deletion and proves both cascades on retry', async mode => {
    seedGroup('planned');
    const api = groupApi();
    api.groupState.keepChildren = true;
    const recordsAtDelete: RegisteredTestArtifact[][] = [];
    api.groupState.onDelete = () => { recordsAtDelete.push(listRegisteredTestArtifacts()); };
    const release = vi.fn((entry: RegisteredTestArtifact) => unregisterTestArtifact(entry.kind, entry.name));
    const attempt = () => mode === 'teardown'
      ? cleanupSyntheticTestArtifacts(api.request, baseline, listRegisteredTestArtifacts(), release) : recover(api);
    const expectBothCascadeReads = () => {
      const cascades = api.get.mock.calls.map(([url]) => new URL(url, TARGET.baseURL).searchParams.get('dataset'))
        .filter(dataset => dataset === 'system_user_group_memberships' || dataset === 'system_group_table_func_rights');
      expect(cascades).toEqual(['system_user_group_memberships', 'system_group_table_func_rights']);
    };

    await expect(attempt()).rejects.toThrow('cascade left system_user_group_memberships');
    expect(api.groups.map(group => group.id)).toEqual([920, 921]);
    expect(recordsAtDelete).toEqual([[expect.objectContaining({ status: 'confirmed', serverId: 919 })]]);
    expect(listRegisteredTestArtifacts()).toEqual([expect.objectContaining({ status: 'confirmed', serverId: 919 })]);
    expectDeadRecordKept();
    expect(release).not.toHaveBeenCalled();

    api.memberships.length = 0;
    api.get.mockClear();
    await expect(attempt()).rejects.toThrow('cascade left system_group_table_func_rights');
    expectBothCascadeReads();
    expectDeadRecordKept();
    expect(listRegisteredTestArtifacts()).toEqual([expect.objectContaining({ status: 'confirmed', serverId: 919 })]);
    expect(release).not.toHaveBeenCalled();

    api.grants.length = 0;
    api.get.mockClear();
    await attempt();
    expectBothCascadeReads();
    expect(api.post).toHaveBeenCalledOnce();
    expect(listRegisteredTestArtifacts()).toEqual([]);
    if (mode === 'teardown') expect(release).toHaveBeenCalledOnce();
    else expect(fs.existsSync(path.join(root, RUN_ID))).toBe(false);
  });

  test.each(['replacement', 'rename', 'rename during CSRF', 'malformed inventory'] as const)
  ('refuses %s without deleting or releasing ownership', async scenario => {
    const api = groupApi();
    if (scenario === 'replacement') api.groups[0].id = 999;
    if (scenario === 'rename') api.groups[0].name = 'renamed';
    if (scenario === 'rename during CSRF') api.state.onCsrf = () => { api.groups[0].name = 'renamed'; };
    if (scenario === 'malformed inventory') api.groupState.badRead = true;
    const release = vi.fn();
    await expect(cleanupSyntheticTestArtifacts(api.request, baseline, [artifact()], release)).rejects.toThrow();
    expect(api.post).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
  });

  test.each(['HTTP failure', 'surviving group', 'surviving membership', 'surviving grant'])
  ('reports %s and keeps the registry for retry', async scenario => {
    seedGroup();
    const api = groupApi();
    if (scenario === 'HTTP failure') api.groupState.deleteStatus = 500;
    if (scenario === 'surviving group') api.groupState.keepGroup = true;
    if (scenario.startsWith('surviving ') && scenario !== 'surviving group') {
      api.groupState.keepChildren = true;
      if (scenario === 'surviving membership') api.grants.length = 0;
      else api.memberships.length = 0;
    }
    await expect(cleanupSyntheticTestArtifacts(api.request, baseline, listRegisteredTestArtifacts(),
      entry => unregisterTestArtifact(entry.kind, entry.name))).rejects.toThrow();
    expect(listRegisteredTestArtifacts()).toHaveLength(1);
  });

  test('releases proven group cleanup before an unrelated language inventory fails', async () => {
    seedGroup();
    const api = groupApi();
    const originalGet = api.get.getMockImplementation()!;
    api.get.mockImplementation((url, options) => url === '/api/translations?lang=en'
      ? Promise.resolve(response({}, 500)) : originalGet(url, options));
    await expect(cleanupSyntheticTestArtifacts(api.request, baseline, listRegisteredTestArtifacts(),
      entry => unregisterTestArtifact(entry.kind, entry.name))).rejects.toThrow();
    expect(listRegisteredTestArtifacts()).toEqual([]);
  });

  test.each(['users', `copy_${name}`, `${name}_copy`,
    'e2e_c17_card_reader_1_abc123', 'e2e_other_mgnhl6v8_abc123'])
  ('refuses names outside the exact run-owned C17 family: %s', badName => {
    expect(() => validateRegisteredTestGroups([{ ...artifact(), name: badName }], RUN_ID, Date.parse(START)))
      .toThrow('Refusing unproven');
  });

  test.each(['confirmed', 'planned'] as const)('dead-run recovery removes the %s group and cascades', async status => {
    seedGroup(status);
    const api = groupApi();
    const { run, log } = await recover(api);
    expect(run.runId).toBe('run-new-recovery');
    expect(api.groups.map(group => group.id)).toEqual([920, 921]);
    expect(api.memberships).toEqual([]);
    expect(api.grants).toEqual([]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining(`[E2E recovery] group="${name}"`));
    expect(listRegisteredTestArtifacts()).toEqual([]);
  });

  test('failed dead-run deletion preserves evidence and succeeds on the next attempt', async () => {
    seedGroup();
    const api = groupApi();
    api.groupState.deleteStatus = 500;
    await expect(recover(api)).rejects.toThrow();
    expectDeadRecordKept();
    expect(listRegisteredTestArtifacts()).toHaveLength(1);
    api.groupState.deleteStatus = 200;
    await recover(api);
    expect(listRegisteredTestArtifacts()).toEqual([]);
  });
});
