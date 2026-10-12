/**
 * test-artifact-stale-run-recovery.test.ts
 * Proves dead-run recovery and refusal boundaries without sockets or a database.
 * Bridges real temporary registry files and fake administrator API responses.
 * Protects exact ownership, target identity, concurrency and retry behavior.
 */
// @vitest-environment node
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import {
  getCurrentArtifactRun, initializeArtifactRunRegistry,
  listRegisteredTestArtifacts, registerTestArtifact,
} from './test-artifact-run-registry';
import { initializeArtifactRunRegistryWithRecovery, recoverStaleRunDatasets } from './test-artifact-stale-run-recovery';
import { buildTempDatasetName } from './temp-dataset';
import { datasetTreeNode, treeResponseForDatasets, treeResponseWithDatasetNodes } from './test-artifact-tree-fixture';

import {
  DEAD_PID, DEAD_WORKER, RUN_ID, START, CREATED, TARGET, plannedName, root, livePids,
  response, fakeApi, seedArtifact, recover, expectDeadRecordKept, useRecoveryRegistry,
} from './test-artifact-recovery-fakes';

useRecoveryRegistry();

describe('automatic dead E2E artifact run recovery', () => {
  test('Views root and unregistered views: present confirmed artifact drops exact name and id, then initializes', async () => {
    seedArtifact();
    const api = fakeApi({ e2e_recorded: { uid: 919 }, e2e_unrecorded: { uid: 999 } });
    const { run, log } = await recover(api);
    expect(api.post).toHaveBeenCalledExactlyOnceWith('/api/drop-dataset', {
      data: { dataset_name: 'e2e_recorded', confirm_dataset_name: 'e2e_recorded' },
      headers: { 'X-CSRF-Token': 'fake-csrf' },
    });
    expect(api.datasets).toEqual({ e2e_unrecorded: { uid: 999 } });
    expect(log).toHaveBeenCalledExactlyOnceWith('[E2E recovery] dataset="e2e_recorded" serverId=919 outcome=dropped');
    expect(run.runId).toBe('run-new-recovery');
    expect(fs.existsSync(path.join(root, RUN_ID))).toBe(false);
    expect(listRegisteredTestArtifacts()).toEqual([]);
  });

  test('Views root and unregistered views: absent confirmed artifact recovers without a drop', async () => {
    seedArtifact();
    const api = fakeApi();
    const { log } = await recover(api);
    expect(api.post).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledExactlyOnceWith('[E2E recovery] dataset="e2e_recorded" serverId=919 outcome=already absent');
  });

  test.each(['both', 'tree only', 'dataset catalogue only'])
  ('Views root and unregistered views: confirmed id survives a rename in %s; keep all evidence', async inventory => {
    seedArtifact();
    seedArtifact('e2e_second', 'confirmed', 921);
    const api = fakeApi({ e2e_renamed: { uid: 919 }, e2e_second: { uid: 921 } });
    const originalGet = api.get.getMockImplementation()!;
    api.get.mockImplementation(async (url, options) => {
      if (inventory === 'tree only' && url === '/api/datasets') {
        return response({ datasets: [{ dataset_name: 'e2e_second', table_uid: 921 }] });
      }
      if (inventory === 'dataset catalogue only' && url === '/api/tree_data') {
        return response(treeResponseForDatasets({ e2e_second: { uid: 921 } }));
      }
      return originalGet(url, options);
    });
    const evidence = listRegisteredTestArtifacts(RUN_ID);
    const pointer = fs.readFileSync(path.join(root, 'current-run.json'), 'utf8');
    const descriptor = fs.readFileSync(path.join(root, RUN_ID, 'run.json'), 'utf8');
    const log = vi.fn();
    await expect(recover(api, log)).rejects.toThrow(/recorded dataset "e2e_recorded" serverId=919.*dataset "e2e_renamed" serverId=919/);
    expect(api.post).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    expectDeadRecordKept();
    expect(listRegisteredTestArtifacts(RUN_ID)).toEqual(evidence);
    expect(fs.readFileSync(path.join(root, 'current-run.json'), 'utf8')).toBe(pointer);
    expect(fs.readFileSync(path.join(root, RUN_ID, 'run.json'), 'utf8')).toBe(descriptor);
    expect(api.datasets.e2e_renamed.uid).toBe(919);
  });

  test.each([undefined, null, '', 'invalid', '0', '-1', '1.5', Number.MAX_SAFE_INTEGER + 1])
  ('Views root and unregistered views: malformed dataset UID %j refuses and keeps evidence', async uid => {
    seedArtifact();
    const api = fakeApi();
    const originalGet = api.get.getMockImplementation()!;
    api.get.mockImplementation(async (url, options) => url === '/api/tree_data'
      ? response(treeResponseWithDatasetNodes([datasetTreeNode('unrelated', uid)]))
      : originalGet(url, options));
    const evidence = listRegisteredTestArtifacts(RUN_ID);
    const log = vi.fn();
    await expect(recover(api, log)).rejects.toThrow(/stable table_uid required/);
    expect(api.post).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    expectDeadRecordKept();
    expect(listRegisteredTestArtifacts(RUN_ID)).toEqual(evidence);
  });

  test('Views root and unregistered views: nested datasets and a registered view keep their dataset identities', async () => {
    seedArtifact();
    const api = fakeApi({ e2e_recorded: { uid: 919 }, registered_view: { uid: 920 }, nested_dataset: { uid: 921 } });
    await recover(api);
    expect(api.post).toHaveBeenCalledOnce();
    expect(api.datasets).toEqual({ registered_view: { uid: 920 }, nested_dataset: { uid: 921 } });
  });

  test('a confirmed dataset renamed during CSRF acquisition refuses before drop', async () => {
    seedArtifact();
    const api = fakeApi({ e2e_recorded: { uid: 919 } });
    api.state.onCsrf = () => {
      api.datasets.e2e_renamed = api.datasets.e2e_recorded;
      delete api.datasets.e2e_recorded;
    };
    await expect(recover(api)).rejects.toThrow(/e2e_recorded.*e2e_renamed.*refusing renamed identity/);
    expect(api.post).not.toHaveBeenCalled();
    expectDeadRecordKept();
  });

  test('a confirmed renamed survivor is reported even when another id reuses the old name', async () => {
    seedArtifact();
    const api = fakeApi({ e2e_recorded: { uid: 920 }, e2e_renamed: { uid: 919 } });
    await expect(recover(api)).rejects.toThrow(/recorded dataset "e2e_recorded" serverId=919.*dataset "e2e_renamed" serverId=919/);
    expect(api.post).not.toHaveBeenCalled();
    expectDeadRecordKept();
    expect(listRegisteredTestArtifacts(RUN_ID)).toHaveLength(1);
  });

  test('a drop returning success but renaming the confirmed dataset keeps evidence', async () => {
    seedArtifact();
    const api = fakeApi({ e2e_recorded: { uid: 919 } });
    api.post.mockImplementationOnce(async () => {
      api.datasets.e2e_renamed = api.datasets.e2e_recorded;
      delete api.datasets.e2e_recorded;
      return response({ message: 'dropped' });
    });
    const log = vi.fn();
    await expect(recover(api, log)).rejects.toThrow(/e2e_recorded.*e2e_renamed.*refusing renamed identity/);
    expect(api.post).toHaveBeenCalledOnce();
    expect(log).not.toHaveBeenCalled();
    expectDeadRecordKept();
    expect(listRegisteredTestArtifacts(RUN_ID)).toHaveLength(1);
  });

  test('planned absence keeps the exact-name rule despite another surviving dataset id', async () => {
    seedArtifact(plannedName(), 'planned');
    const api = fakeApi({ e2e_renamed: { uid: 919 } });
    const { log } = await recover(api);
    expect(api.post).not.toHaveBeenCalled();
    expect(api.datasets.e2e_renamed.uid).toBe(919);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('outcome=already absent'));
  });

  test('planned artifact with a generated name at or after dead run start is dropped', async () => {
    seedArtifact(plannedName(), 'planned');
    const api = fakeApi({ [plannedName()]: { uid: 921, created: CREATED } });
    const { log } = await recover(api);
    expect(api.post).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith(`[E2E recovery] dataset=${JSON.stringify(plannedName())} serverId=921 outcome=dropped`);
  });

  test('planned artifact absent is recovered without a drop', async () => {
    seedArtifact(plannedName(), 'planned');
    const api = fakeApi();
    const { log } = await recover(api);
    expect(api.post).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(`[E2E recovery] dataset=${JSON.stringify(plannedName())} serverId=unknown outcome=already absent`);
  });

  test.each([START, '2026-10-11T11:59:59.000Z', '2026-10-11T14:00:00', null, undefined, 'invalid'])
  ('valid planned name ignores database creation time: %s', async (created) => {
    seedArtifact(plannedName(), 'planned');
    const api = fakeApi({ [plannedName()]: { uid: 921, created } });
    await recover(api);
    expect(api.post).toHaveBeenCalledOnce();
    expect(fs.existsSync(path.join(root, RUN_ID))).toBe(false);
  });

  test.each(['e2e_planned', 'e2e_planned_badtime_abc123', 'e2e_planned_0abc_abc123',
    plannedName(Date.parse(START) - 1), `${plannedName()}_extra`, plannedName().replace('abc123', 'abc')])
  ('unproven planned name is skipped even with a misleading server creation time: %s', async (name) => {
    seedArtifact(name, 'planned');
    // A timezone-less registry value at 14:00 in UTC+3 predates the 12:00Z
    // run but Go serializes it as 14:00Z. Round A incorrectly trusted that Z.
    const created = '2026-10-11T14:00:00Z';
    const api = fakeApi({ [name]: { uid: 921, created } });
    // Model the optional administrator override so Round A reaches its unsafe
    // ownership decision independently of the separate post-drop 403 defect.
    api.state.absentMetadataStatus = 200;
    const { log } = await recover(api);
    expect(api.post).not.toHaveBeenCalled();
    expect(api.datasets[name]).toEqual({ uid: 921, created });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('outcome=skipped: generated name at or after run start not proven'));
    expect(fs.existsSync(path.join(root, RUN_ID))).toBe(false);
  });

  test('planned name generated at exactly run start proves ownership', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse(START));
    vi.spyOn(Math, 'random').mockReturnValue(0.123456789);
    const name = buildTempDatasetName('E2E Planned Dataset');
    seedArtifact(name, 'planned');
    const api = fakeApi({ [name]: { uid: 921 } });
    await recover(api);
    expect(api.post).toHaveBeenCalledOnce();
  });

  test('successful drop finishes despite metadata permissions being removed (403)', async () => {
    seedArtifact();
    const api = fakeApi({ e2e_recorded: { uid: 919 } });
    const { run } = await recover(api);
    expect(api.state.absentMetadataStatus).toBe(403);
    expect(api.post).toHaveBeenCalledOnce();
    expect(run.runId).toBe('run-new-recovery');
    expect(fs.existsSync(path.join(root, RUN_ID))).toBe(false);
    expect(api.get.mock.calls.filter(([url]) => url === '/api/get-metadata')).toHaveLength(3);
  });

  test('a metadata 403 with a present dataset refuses and keeps evidence', async () => {
    seedArtifact();
    const api = fakeApi({ e2e_recorded: { uid: 919 } });
    api.state.metadataStatus = 403;
    await expect(recover(api)).rejects.toThrow(/get-metadata.*status=403/);
    expect(api.post).not.toHaveBeenCalled();
    expectDeadRecordKept();
  });

  test('a failed administrator inventory never proves absence', async () => {
    seedArtifact();
    const api = fakeApi();
    api.state.inventoryStatus = 403;
    await expect(recover(api)).rejects.toThrow(/GET \/api\/datasets.*status=403/);
    expect(api.post).not.toHaveBeenCalled();
    expectDeadRecordKept();
  });

  test('changed installation identity refuses despite the same URL, name, UID and versions', async () => {
    seedArtifact();
    const pointer = fs.readFileSync(path.join(root, 'current-run.json'), 'utf8');
    const descriptor = fs.readFileSync(path.join(root, RUN_ID, 'run.json'), 'utf8');
    const api = fakeApi({ e2e_recorded: { uid: 919 } });
    api.state.databaseId = 'b'.repeat(32);
    api.state.absentMetadataStatus = 200;
    await expect(recover(api)).rejects.toThrow(/installation identity mismatch/);
    expect(api.post).not.toHaveBeenCalled();
    expectDeadRecordKept();
    expect(listRegisteredTestArtifacts(RUN_ID)).toHaveLength(1);
    expect(fs.readFileSync(path.join(root, 'current-run.json'), 'utf8')).toBe(pointer);
    expect(fs.readFileSync(path.join(root, RUN_ID, 'run.json'), 'utf8')).toBe(descriptor);
  });

  test('changed target URL refuses even when the copied database identity matches', async () => {
    seedArtifact();
    const api = fakeApi({ e2e_recorded: { uid: 919 } });
    await expect(initializeArtifactRunRegistryWithRecovery({ rootDirectory: root },
      (run, artifacts, stillDead) => recoverStaleRunDatasets(api.request,
        { userId: 4, username: 'test_admin', baseURL: 'https://copy.invalid' }, run, artifacts, stillDead)))
      .rejects.toThrow(/target URL mismatch/);
    expect(api.post).not.toHaveBeenCalled();
    expectDeadRecordKept();
  });

  test('installation changes during CSRF acquisition refuse before dropping', async () => {
    seedArtifact();
    const api = fakeApi({ e2e_recorded: { uid: 919 } });
    api.state.onCsrf = () => { api.state.databaseId = 'b'.repeat(32); };
    await expect(recover(api)).rejects.toThrow(/installation identity mismatch/);
    expect(api.post).not.toHaveBeenCalled();
    expectDeadRecordKept();
  });

  test('installation changes during the final dataset read refuse before dropping', async () => {
    seedArtifact();
    const api = fakeApi({ e2e_recorded: { uid: 919 } });
    let reads = 0;
    api.state.onMetadata = () => { if (++reads === 3) api.state.databaseId = 'b'.repeat(32); };
    await expect(recover(api)).rejects.toThrow(/installation identity mismatch/);
    expect(api.post).not.toHaveBeenCalled();
    expectDeadRecordKept();
  });

  test('server-id mismatch refuses with the exact artifact and preserves the dead record', async () => {
    seedArtifact();
    const api = fakeApi({ e2e_recorded: { uid: 920 } });
    await expect(recover(api)).rejects.toThrow(/dataset="e2e_recorded" serverId=919.*server-id mismatch: recorded=919, current=920/);
    expect(api.post).not.toHaveBeenCalled();
    expectDeadRecordKept();
  });

  test('all artifacts are preflighted before any drop when another confirmed artifact mismatches', async () => {
    seedArtifact();
    seedArtifact('e2e_second', 'confirmed', 921);
    const api = fakeApi({ e2e_recorded: { uid: 920 }, e2e_second: { uid: 921 } });
    await expect(recover(api)).rejects.toThrow(/e2e_recorded.*server-id mismatch/);
    expect(api.post).not.toHaveBeenCalled();
    expectDeadRecordKept();
  });

  test('live owner PID refuses before login, inventory or drop even with a reused foreign nonce', async () => {
    seedArtifact();
    livePids.add(DEAD_PID);
    const callback = vi.fn();
    await expect(initializeArtifactRunRegistryWithRecovery({ rootDirectory: root }, callback))
      .rejects.toThrow(/parallel Playwright runs are not allowed/);
    expect(callback).not.toHaveBeenCalled();
    expectDeadRecordKept();
  });

  test('live recording worker PID refuses after its run owner has died', async () => {
    seedArtifact();
    livePids.add(DEAD_WORKER);
    const api = fakeApi();
    await expect(recover(api)).rejects.toThrow(/dataset "e2e_recorded": recording worker PID 919192 is live/);
    expect(api.get).not.toHaveBeenCalled();
    expectDeadRecordKept();
  });

  test('failing drop keeps today’s fail-closed refusal even if its body says does not exist', async () => {
    seedArtifact();
    const api = fakeApi({ e2e_recorded: { uid: 919 } });
    api.state.dropStatus = 503;
    await expect(recover(api)).rejects.toThrow(/POST \/api\/drop-dataset.*dataset="e2e_recorded" serverId=919 status=503/);
    expectDeadRecordKept();
    expect(listRegisteredTestArtifacts(RUN_ID)).toHaveLength(1);
  });

  test('a successful drop that leaves its dataset refuses and keeps the registry evidence', async () => {
    seedArtifact();
    const api = fakeApi({ e2e_recorded: { uid: 919 } });
    api.state.keepOnDrop = true;
    await expect(recover(api)).rejects.toThrow(/e2e_recorded.*drop reported success but dataset remains/);
    expectDeadRecordKept();
  });

  test('partial recovery failure keeps all records and resumes from already-absent datasets', async () => {
    seedArtifact();
    seedArtifact('e2e_second', 'confirmed', 921);
    const api = fakeApi({ e2e_recorded: { uid: 919 }, e2e_second: { uid: 921 } });
    api.state.dropStatus = 503;
    api.post.mockImplementationOnce(async (_url, options) => {
      delete api.datasets[options.data.dataset_name];
      return response({ message: 'dropped' });
    });
    await expect(recover(api)).rejects.toThrow(/POST \/api\/drop-dataset.*status=503/);
    expectDeadRecordKept();
    expect(listRegisteredTestArtifacts(RUN_ID)).toHaveLength(2);
    expect(Object.keys(api.datasets)).toHaveLength(1);
    api.state.dropStatus = 200;
    const { log } = await recover(api);
    expect(api.datasets).toEqual({});
    expect(api.post).toHaveBeenCalledTimes(3);
    expect(log.mock.calls.flat().filter((line: string) => line.includes('already absent'))).toHaveLength(1);
    expect(fs.existsSync(path.join(root, RUN_ID))).toBe(false);
  });

  test('corrupt record refuses before API access and names its registry file', async () => {
    seedArtifact();
    const directory = path.join(root, RUN_ID, 'artifacts', 'dataset');
    const file = path.join(directory, fs.readdirSync(directory)[0]);
    fs.writeFileSync(file, '{broken');
    const api = fakeApi();
    await expect(recover(api)).rejects.toThrow(`Corrupt registered E2E dataset at ${file}`);
    expect(api.get).not.toHaveBeenCalled();
    expectDeadRecordKept();
  });

  test.each(['current-run.json', `${RUN_ID}/run.json`])('corrupt run identity refuses: %s', async (file) => {
    seedArtifact();
    fs.writeFileSync(path.join(root, file), '{broken');
    const api = fakeApi();
    await expect(recover(api)).rejects.toThrow(/Corrupt E2E artifact/);
    expect(api.get).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(root, file))).toBe(true);
  });

  test('pointer/descriptor nonce mismatch refuses before any API request', async () => {
    seedArtifact();
    const file = path.join(root, RUN_ID, 'run.json');
    const descriptor = JSON.parse(fs.readFileSync(file, 'utf8'));
    descriptor.processNonce = 'f'.repeat(64);
    fs.writeFileSync(file, JSON.stringify(descriptor));
    const api = fakeApi();
    await expect(recover(api)).rejects.toThrow(/pointer does not match run descriptor/);
    expect(api.get).not.toHaveBeenCalled();
  });

  test.each(['unknown-kind', 'folder'])('unsupported artifact kind refuses: %s', async (kind) => {
    seedArtifact();
    fs.mkdirSync(path.join(root, RUN_ID, 'artifacts', kind));
    if (kind === 'folder') {
      registerTestArtifact('folder', 'e2e_folder');
      const directory = path.join(root, RUN_ID, 'artifacts', 'folder');
      const file = path.join(directory, fs.readdirSync(directory)[0]);
      const artifact = JSON.parse(fs.readFileSync(file, 'utf8'));
      fs.writeFileSync(file, JSON.stringify({ ...artifact, registeredByPid: DEAD_WORKER }));
    }
    const api = fakeApi();
    await expect(recover(api)).rejects.toThrow(kind === 'folder'
      ? /folder "e2e_folder".*datasets only/ : /unknown-kind/);
    expect(api.get).not.toHaveBeenCalled();
    expectDeadRecordKept();
  });

  test.each(['.tmp-unfinished', 'unfinished.json.lock'])('unfinished registry file refuses: %s', async (file) => {
    seedArtifact();
    fs.writeFileSync(path.join(root, RUN_ID, 'artifacts', 'dataset', file), '{}');
    const api = fakeApi();
    await expect(recover(api)).rejects.toThrow(file);
    expect(api.get).not.toHaveBeenCalled();
    expectDeadRecordKept();
  });

  test('foreign run directory refuses even when the current run is dead', async () => {
    seedArtifact();
    fs.mkdirSync(path.join(root, 'run-other-unfinished'));
    const api = fakeApi();
    await expect(recover(api)).rejects.toThrow(/foreign run directories.*run-other-unfinished/);
    expect(api.get).not.toHaveBeenCalled();
  });

  test('startup lock prevents another initializer and recovery while login/recovery is pending', async () => {
    seedArtifact();
    let release!: () => void;
    const pending = initializeArtifactRunRegistryWithRecovery({ rootDirectory: root },
      () => new Promise<void>((resolve) => { release = resolve; }));
    expect(() => initializeArtifactRunRegistry({ rootDirectory: root })).toThrow(/Stale E2E artifact run/);
    await expect(recover()).rejects.toThrow(/active PID.*parallel Playwright/);
    release();
    await pending;
    expect(fs.existsSync(`${root}.startup-lock`)).toBe(false);
  });

  test('dead startup lock owner is reclaimed using its exact PID/nonce filename', async () => {
    seedArtifact();
    fs.mkdirSync(`${root}.startup-lock`);
    const nonce = 'e'.repeat(64);
    fs.writeFileSync(path.join(`${root}.startup-lock`, `owner-${DEAD_PID}-${nonce}.json`),
      JSON.stringify({ pid: DEAD_PID, processNonce: nonce }));
    await recover();
    expect(fs.existsSync(`${root}.startup-lock`)).toBe(false);
  });

  test('a foreign live startup lock blocks even a normal run without a stale pointer', async () => {
    fs.mkdirSync(`${root}.startup-lock`);
    const nonce = 'f'.repeat(64);
    fs.writeFileSync(path.join(`${root}.startup-lock`, `owner-${process.pid}-${nonce}.json`),
      JSON.stringify({ pid: process.pid, processNonce: nonce }));
    await expect(recover()).rejects.toThrow(/active PID.*parallel Playwright/);
    expect(fs.existsSync(path.join(root, 'current-run.json'))).toBe(false);
  });

  test('a corrupt or unfinished startup lock refuses without touching stale artifacts', async () => {
    seedArtifact();
    fs.mkdirSync(`${root}.startup-lock`);
    const api = fakeApi();
    await expect(recover(api)).rejects.toThrow(/Corrupt or unfinished E2E startup lock/);
    expect(api.get).not.toHaveBeenCalled();
    expectDeadRecordKept();
  });

  test('identity replaced while obtaining CSRF refuses before the name-only drop', async () => {
    seedArtifact();
    const api = fakeApi({ e2e_recorded: { uid: 919 } });
    api.state.onCsrf = () => { api.datasets.e2e_recorded.uid = 920; };
    await expect(recover(api)).rejects.toThrow(/e2e_recorded.*server-id mismatch/);
    expect(api.post).not.toHaveBeenCalled();
    expectDeadRecordKept();
  });

  test('planned identity replaced while obtaining CSRF refuses before a drop', async () => {
    seedArtifact(plannedName(), 'planned');
    const api = fakeApi({ [plannedName()]: { uid: 921, created: CREATED } });
    api.state.onCsrf = () => { api.datasets[plannedName()].uid = 922; };
    await expect(recover(api)).rejects.toThrow(/e2e_planned.*identity changed immediately before drop/);
    expect(api.post).not.toHaveBeenCalled();
    expectDeadRecordKept();
  });

  test('registry corrupted while obtaining CSRF refuses before the drop', async () => {
    seedArtifact();
    const api = fakeApi({ e2e_recorded: { uid: 919 } });
    api.state.onCsrf = () => {
      const directory = path.join(root, RUN_ID, 'artifacts', 'dataset');
      fs.writeFileSync(path.join(directory, fs.readdirSync(directory)[0]), '{broken');
    };
    await expect(recover(api)).rejects.toThrow(/e2e_recorded.*Corrupt registered E2E dataset/);
    expect(api.post).not.toHaveBeenCalled();
    expectDeadRecordKept();
  });

  test('PID becomes live while reading identity and refuses before dropping', async () => {
    seedArtifact();
    const api = fakeApi({ e2e_recorded: { uid: 919 } });
    api.state.onCsrf = () => { livePids.add(DEAD_PID); };
    await expect(recover(api)).rejects.toThrow(/e2e_recorded.*owner PID 919191 is live/);
    expect(api.post).not.toHaveBeenCalled();
    expectDeadRecordKept();
  });

  test('wrong administrator session refuses before inventories or drops', async () => {
    seedArtifact();
    const api = fakeApi();
    api.state.profile.user_id = 8;
    await expect(recover(api)).rejects.toThrow(/Authenticated cleanup identity mismatch/);
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.post).not.toHaveBeenCalled();
    expectDeadRecordKept();
  });

  test('failing identity API refuses with the artifact name', async () => {
    seedArtifact();
    const api = fakeApi({ e2e_recorded: { uid: 919 } });
    api.state.metadataStatus = 503;
    await expect(recover(api)).rejects.toThrow(/GET \/api\/get-metadata.*dataset="e2e_recorded" serverId=919 status=503/);
    expect(api.post).not.toHaveBeenCalled();
    expectDeadRecordKept();
  });

  test('normal run without stale record behaves as before and never calls recovery', async () => {
    const callback = vi.fn();
    const options = { rootDirectory: root, runId: 'run-normal-recovery', now: new Date(START) };
    const run = await initializeArtifactRunRegistryWithRecovery(options, callback);
    expect(run).toEqual(initializeArtifactRunRegistry(options));
    expect(run.startedAt).toBe(START);
    expect(callback).not.toHaveBeenCalled();
  });

  test('publishes the target at run initialization under the startup lock', async () => {
    const recovery = vi.fn();
    const readTarget = vi.fn(async () => {
      expect(fs.existsSync(`${root}.startup-lock`)).toBe(true);
      expect(getCurrentArtifactRun({ rootDirectory: root })).toBeNull();
      return TARGET;
    });
    const run = await initializeArtifactRunRegistryWithRecovery({ rootDirectory: root }, recovery, readTarget);
    expect(run.target).toEqual(TARGET);
    expect(getCurrentArtifactRun()?.target).toEqual(TARGET);
    expect(recovery).not.toHaveBeenCalled();
    expect(readTarget).toHaveBeenCalledOnce();
  });

  test('failed target capture publishes no new run and preserves stale evidence', async () => {
    seedArtifact();
    const callback = vi.fn();
    await expect(initializeArtifactRunRegistryWithRecovery({ rootDirectory: root }, callback,
      async () => { throw new Error('installation identity unavailable'); }))
      .rejects.toThrow(/read new run target.*operation failed/);
    expect(callback).not.toHaveBeenCalled();
    expectDeadRecordKept();
    expect(listRegisteredTestArtifacts(RUN_ID)).toHaveLength(1);
  });

  test('a legacy stale descriptor without target identity refuses and preserves records', async () => {
    seedArtifact();
    for (const file of ['current-run.json', `${RUN_ID}/run.json`]) {
      const location = path.join(root, file);
      const run = JSON.parse(fs.readFileSync(location, 'utf8'));
      delete run.target;
      fs.writeFileSync(location, JSON.stringify(run));
    }
    const api = fakeApi({ e2e_recorded: { uid: 919 } });
    await expect(recover(api)).rejects.toThrow(/target identity/);
    expect(api.post).not.toHaveBeenCalled();
    expectDeadRecordKept();
    expect(listRegisteredTestArtifacts(RUN_ID)).toHaveLength(1);
  });

  test('dead empty run still validates its recorded target before finishing', async () => {
    initializeArtifactRunRegistry({ rootDirectory: root, runId: RUN_ID, pid: DEAD_PID, target: TARGET });
    const callback = vi.fn();
    const run = await initializeArtifactRunRegistryWithRecovery({ rootDirectory: root }, callback);
    expect(run.runId).not.toBe(RUN_ID);
    expect(callback).toHaveBeenCalledOnce();
    expect(fs.existsSync(path.join(root, RUN_ID))).toBe(false);
  });
});
