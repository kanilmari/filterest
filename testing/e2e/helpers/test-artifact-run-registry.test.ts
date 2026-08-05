/**
 * test-artifact-run-registry.test.ts
 * Verifies fail-closed and exact-ownership behavior of the E2E artifact run registry.
 * Bridges isolated temporary directories and the registry's public setup/worker/teardown API.
 * Exists to prevent broad prefix cleanup or concurrent runs from reappearing unnoticed.
 */

// @vitest-environment node

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  confirmTestArtifact,
  finishArtifactRunRegistry,
  getCurrentArtifactRun,
  initializeArtifactRunRegistry,
  listRegisteredTestArtifacts,
  registerTestArtifact,
  requireConfirmedTestArtifact,
  unregisterTestArtifact,
} from './test-artifact-run-registry';

let registryRoot = '';

function currentPointerPath(): string {
  return path.join(registryRoot, 'current-run.json');
}

function runDirectory(runId: string): string {
  return path.join(registryRoot, runId);
}

beforeEach(() => {
  registryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'easelect-e2e-registry-'));
});

afterEach(() => {
  fs.rmSync(registryRoot, { recursive: true, force: true });
});

describe('test artifact run registry', () => {
  test('records exact dataset and folder entries and finishes only after unregistering', () => {
    const run = initializeArtifactRunRegistry({
      rootDirectory: registryRoot,
      runId: 'run-unit-basic',
      pid: process.pid,
      now: new Date('2026-07-14T10:00:00.000Z'),
    });

    expect(run).toMatchObject({
      runId: 'run-unit-basic',
      pid: process.pid,
      processNonce: expect.stringMatching(/^[a-f0-9]{64}$/),
      startedAt: '2026-07-14T10:00:00.000Z',
      isPidActive: true,
    });

    const pointer = JSON.parse(fs.readFileSync(currentPointerPath(), 'utf8'));
    const descriptor = JSON.parse(
      fs.readFileSync(path.join(runDirectory(run.runId), 'run.json'), 'utf8'),
    );
    expect(pointer.processNonce).toBe(run.processNonce);
    expect(descriptor.processNonce).toBe(run.processNonce);

    registerTestArtifact('dataset', 'e2e_owned_dataset');
    registerTestArtifact('dataset', 'e2e_owned_dataset');
    registerTestArtifact('folder', 'test_owned_folder');

    expect(listRegisteredTestArtifacts()).toEqual([
      expect.objectContaining({
        kind: 'dataset',
        name: 'e2e_owned_dataset',
        status: 'planned',
        serverId: null,
      }),
      expect.objectContaining({
        kind: 'folder',
        name: 'test_owned_folder',
        status: 'planned',
        serverId: null,
      }),
    ]);
    expect(() => finishArtifactRunRegistry(run.runId)).toThrow(/2 artifact\(s\) remain/);

    unregisterTestArtifact('dataset', 'e2e_owned_dataset');
    unregisterTestArtifact('dataset', 'e2e_owned_dataset');
    unregisterTestArtifact('folder', 'test_owned_folder');
    finishArtifactRunRegistry(run.runId);

    expect(getCurrentArtifactRun({ rootDirectory: registryRoot })).toBeNull();
    expect(fs.existsSync(runDirectory(run.runId))).toBe(false);
  });

  test('uses one atomic entry file per exact artifact instead of a shared manifest rewrite', () => {
    const run = initializeArtifactRunRegistry({
      rootDirectory: registryRoot,
      runId: 'run-unit-atomic',
    });
    registerTestArtifact('dataset', 'test_same_prefix_owned');
    registerTestArtifact('dataset', 'test_same_prefix_other');

    const datasetDirectory = path.join(runDirectory(run.runId), 'artifacts', 'dataset');
    const entryNames = fs.readdirSync(datasetDirectory);
    expect(entryNames).toHaveLength(2);
    expect(entryNames.every((name) => /^[a-f0-9]{64}\.json$/.test(name))).toBe(true);
    expect(entryNames.some((name) => name.startsWith('.tmp-'))).toBe(false);
  });

  test('keeps planned artifacts distinct from server-confirmed artifacts', () => {
    initializeArtifactRunRegistry({
      rootDirectory: registryRoot,
      runId: 'run-unit-planned',
    });
    registerTestArtifact('dataset', 'e2e_planned_dataset');

    expect(listRegisteredTestArtifacts()).toEqual([
      expect.objectContaining({
        kind: 'dataset',
        name: 'e2e_planned_dataset',
        status: 'planned',
        serverId: null,
        confirmedAt: null,
      }),
    ]);
  });

  test('confirms an artifact atomically and idempotently', () => {
    const run = initializeArtifactRunRegistry({
      rootDirectory: registryRoot,
      runId: 'run-unit-confirmed',
    });
    registerTestArtifact('dataset', 'e2e_confirmed_dataset');

    confirmTestArtifact('dataset', 'e2e_confirmed_dataset', 8123);
    const [firstConfirmation] = listRegisteredTestArtifacts();
    expect(firstConfirmation).toMatchObject({
      kind: 'dataset',
      name: 'e2e_confirmed_dataset',
      status: 'confirmed',
      serverId: 8123,
    });
    expect(firstConfirmation.confirmedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    confirmTestArtifact('dataset', 'e2e_confirmed_dataset', 8123);
    expect(listRegisteredTestArtifacts()).toEqual([firstConfirmation]);

    const datasetDirectory = path.join(runDirectory(run.runId), 'artifacts', 'dataset');
    expect(fs.readdirSync(datasetDirectory)).toEqual([
      expect.stringMatching(/^[a-f0-9]{64}\.json$/),
    ]);
  });

  test('requires a positive stable server id before confirming any artifact', () => {
    initializeArtifactRunRegistry({
      rootDirectory: registryRoot,
      runId: 'run-unit-folder-confirm',
    });
    registerTestArtifact('folder', 'e2e_planned_folder');

    expect(() => confirmTestArtifact(
      'folder',
      'e2e_planned_folder',
      undefined as unknown as number,
    )).toThrow(
      /Invalid E2E folder serverId/,
    );
    expect(() => confirmTestArtifact('folder', 'e2e_planned_folder', 0)).toThrow(
      /Invalid E2E folder serverId/,
    );
    expect(listRegisteredTestArtifacts()).toEqual([
      expect.objectContaining({
        name: 'e2e_planned_folder',
        status: 'planned',
        serverId: null,
      }),
    ]);

    confirmTestArtifact('folder', 'e2e_planned_folder', 91);
    expect(listRegisteredTestArtifacts()).toEqual([
      expect.objectContaining({
        name: 'e2e_planned_folder',
        status: 'confirmed',
        serverId: 91,
      }),
    ]);
  });

  test('planned records cannot authorize cleanup and confirmed identities must match', () => {
    initializeArtifactRunRegistry({
      rootDirectory: registryRoot,
      runId: 'run-unit-cleanup-identity',
    });
    registerTestArtifact('dataset', 'e2e_owned_by_uid');

    expect(() => requireConfirmedTestArtifact('dataset', 'e2e_owned_by_uid'))
      .toThrow(/Cannot clean planned/);

    confirmTestArtifact('dataset', 'e2e_owned_by_uid', 451);
    expect(requireConfirmedTestArtifact('dataset', 'e2e_owned_by_uid', 451))
      .toMatchObject({ status: 'confirmed', serverId: 451 });
    expect(() => requireConfirmedTestArtifact('dataset', 'e2e_owned_by_uid', 452))
      .toThrow(/server identity mismatch/);
  });

  test('fails closed when a planned-to-confirmed transition reads corrupt state', () => {
    const run = initializeArtifactRunRegistry({
      rootDirectory: registryRoot,
      runId: 'run-unit-corrupt-transition',
    });
    registerTestArtifact('dataset', 'e2e_corrupt_transition');
    const datasetDirectory = path.join(runDirectory(run.runId), 'artifacts', 'dataset');
    const [entryName] = fs.readdirSync(datasetDirectory);
    const entryPath = path.join(datasetDirectory, entryName);
    fs.writeFileSync(entryPath, '{broken-transition', 'utf8');

    expect(() => confirmTestArtifact('dataset', 'e2e_corrupt_transition', 8124)).toThrow(
      /Corrupt registered E2E dataset/,
    );
    expect(fs.readFileSync(entryPath, 'utf8')).toBe('{broken-transition');
    expect(fs.readdirSync(datasetDirectory)).toEqual([entryName]);
  });

  test('blocks a parallel initializer while the recorded PID is active', () => {
    initializeArtifactRunRegistry({
      rootDirectory: registryRoot,
      runId: 'run-unit-active',
      pid: process.pid,
    });

    expect(() => initializeArtifactRunRegistry({
      rootDirectory: registryRoot,
      runId: 'run-unit-parallel',
      pid: process.pid + 1_000_000,
    })).toThrow(/parallel Playwright runs are not allowed/);
  });

  test('rejects a reused active PID when the recorded process nonce is foreign', () => {
    const run = initializeArtifactRunRegistry({
      rootDirectory: registryRoot,
      runId: 'run-unit-reused-pid',
      pid: process.pid,
    });
    const foreignNonce = run.processNonce.startsWith('0')
      ? `1${run.processNonce.slice(1)}`
      : `0${run.processNonce.slice(1)}`;
    const foreignRun = { ...run, processNonce: foreignNonce };
    delete (foreignRun as Partial<typeof foreignRun>).isPidActive;
    fs.writeFileSync(currentPointerPath(), `${JSON.stringify(foreignRun, null, 2)}\n`, 'utf8');
    fs.writeFileSync(
      path.join(runDirectory(run.runId), 'run.json'),
      `${JSON.stringify(foreignRun, null, 2)}\n`,
      'utf8',
    );

    expect(() => initializeArtifactRunRegistry({
      rootDirectory: registryRoot,
      runId: run.runId,
      pid: process.pid,
    })).toThrow(/belongs to another active process identity/);
    expect(getCurrentArtifactRun({ rootDirectory: registryRoot })).toMatchObject({
      runId: run.runId,
      pid: process.pid,
      processNonce: foreignNonce,
    });
  });

  test('fails closed when pointer and descriptor process nonces disagree', () => {
    const run = initializeArtifactRunRegistry({
      rootDirectory: registryRoot,
      runId: 'run-unit-nonce-mismatch',
    });
    const descriptorPath = path.join(runDirectory(run.runId), 'run.json');
    const descriptor = JSON.parse(fs.readFileSync(descriptorPath, 'utf8'));
    descriptor.processNonce = descriptor.processNonce.startsWith('0')
      ? `1${descriptor.processNonce.slice(1)}`
      : `0${descriptor.processNonce.slice(1)}`;
    fs.writeFileSync(descriptorPath, `${JSON.stringify(descriptor, null, 2)}\n`, 'utf8');

    expect(() => getCurrentArtifactRun({ rootDirectory: registryRoot })).toThrow(
      /current-run pointer does not match run descriptor/,
    );
  });

  test('keeps a dead-PID run readable and refuses to overwrite it silently', () => {
    const staleRun = initializeArtifactRunRegistry({
      rootDirectory: registryRoot,
      runId: 'run-unit-stale',
      pid: 2_147_483_647,
    });
    registerTestArtifact('dataset', 'e2e_stale_owned');

    expect(getCurrentArtifactRun({ rootDirectory: registryRoot })).toMatchObject({
      runId: staleRun.runId,
      isPidActive: false,
    });
    expect(listRegisteredTestArtifacts(staleRun.runId)).toEqual([
      expect.objectContaining({ kind: 'dataset', name: 'e2e_stale_owned' }),
    ]);
    expect(() => initializeArtifactRunRegistry({
      rootDirectory: registryRoot,
      runId: 'run-unit-replacement',
    })).toThrow(/must be inspected and finished explicitly/);

    unregisterTestArtifact('dataset', 'e2e_stale_owned');
    finishArtifactRunRegistry(staleRun.runId);
    expect(initializeArtifactRunRegistry({
      rootDirectory: registryRoot,
      runId: 'run-unit-replacement',
    }).runId).toBe('run-unit-replacement');
  });

  test('fails closed for a corrupt current-run pointer', () => {
    fs.writeFileSync(currentPointerPath(), '{not-json', 'utf8');

    expect(() => getCurrentArtifactRun({ rootDirectory: registryRoot })).toThrow(
      /Corrupt E2E artifact current-run pointer/,
    );
    expect(() => initializeArtifactRunRegistry({
      rootDirectory: registryRoot,
      runId: 'run-unit-after-corrupt-pointer',
    })).toThrow(/Corrupt E2E artifact current-run pointer/);
  });

  test('fails closed for a corrupt artifact entry and preserves the run directory', () => {
    const run = initializeArtifactRunRegistry({
      rootDirectory: registryRoot,
      runId: 'run-unit-corrupt-entry',
    });
    registerTestArtifact('folder', 'e2e_corrupt_folder');

    const folderDirectory = path.join(runDirectory(run.runId), 'artifacts', 'folder');
    const [entryName] = fs.readdirSync(folderDirectory);
    fs.writeFileSync(path.join(folderDirectory, entryName), '{broken', 'utf8');

    expect(() => listRegisteredTestArtifacts(run.runId)).toThrow(
      /Corrupt registered E2E folder/,
    );
    expect(() => finishArtifactRunRegistry(run.runId)).toThrow(
      /Corrupt registered E2E folder/,
    );
    expect(fs.existsSync(runDirectory(run.runId))).toBe(true);
    expect(fs.existsSync(currentPointerPath())).toBe(true);
  });

  test('fails closed for an unknown artifact-kind directory', () => {
    const run = initializeArtifactRunRegistry({
      rootDirectory: registryRoot,
      runId: 'run-unit-unknown-kind',
    });
    fs.mkdirSync(path.join(runDirectory(run.runId), 'artifacts', 'unknown-kind'), {
      recursive: true,
    });

    expect(() => listRegisteredTestArtifacts(run.runId)).toThrow(
      /Unexpected artifact kind entry/,
    );
    expect(() => finishArtifactRunRegistry(run.runId)).toThrow(
      /Unexpected artifact kind entry/,
    );
  });

  test('does not infer ownership from e2e or test prefixes', () => {
    initializeArtifactRunRegistry({
      rootDirectory: registryRoot,
      runId: 'run-unit-exact-only',
    });
    registerTestArtifact('dataset', 'e2e_registered_exactly');

    const registeredNames = listRegisteredTestArtifacts().map((artifact) => artifact.name);
    expect(registeredNames).toEqual(['e2e_registered_exactly']);
    expect(registeredNames).not.toContain('e2e_unregistered_same_prefix');
    expect(registeredNames).not.toContain('test_unregistered_same_prefix');
  });
});
