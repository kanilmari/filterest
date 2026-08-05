/**
 * global-teardown.test.ts
 * Proves a rejected parallel runner cannot tear down another PID's registry or auth state.
 */

import type { FullConfig } from '@playwright/test';
import { beforeEach, expect, test, vi } from 'vitest';

const cleanupMocks = vi.hoisted(() => ({
  cleanupSyntheticTestArtifactsWithStorageState: vi.fn(),
  normalizeE2EBaseURL: vi.fn((value: string) => value),
  readLangKeyInventoryWithStorageState: vi.fn(),
  validateSyntheticArtifactBaseline: vi.fn(),
}));

const registryMocks = vi.hoisted(() => ({
  finishArtifactRunRegistry: vi.fn(),
  getArtifactRegistryProcessIdentity: vi.fn(),
  getCurrentArtifactRun: vi.fn(),
  listRegisteredTestArtifacts: vi.fn(),
  unregisterTestArtifact: vi.fn(),
}));

const storageMocks = vi.hoisted(() => ({
  removeStorageStateFile: vi.fn(),
}));

vi.mock('./test-artifact-cleanup', () => cleanupMocks);
vi.mock('./test-artifact-run-registry', () => registryMocks);
vi.mock('./storage-state-file', () => storageMocks);

import globalTeardown from '../global-teardown';

beforeEach(() => {
  vi.clearAllMocks();
  registryMocks.getArtifactRegistryProcessIdentity.mockReturnValue({
    pid: process.pid,
    processNonce: 'a'.repeat(64),
  });
});

test('foreign artifact run fails before registry, cleanup, or auth-state mutation', async () => {
  registryMocks.getCurrentArtifactRun.mockReturnValue({
    version: 1,
    runId: 'run-foreign-owner',
    pid: process.pid + 1,
    processNonce: 'b'.repeat(64),
    startedAt: '2026-01-01T00:00:00.000Z',
    isPidActive: true,
  });

  await expect(globalTeardown({} as FullConfig)).rejects.toThrow(
    `belongs to another process identity (recorded PID ${process.pid + 1}, `
    + `teardown PID ${process.pid})`,
  );

  expect(registryMocks.listRegisteredTestArtifacts).not.toHaveBeenCalled();
  expect(registryMocks.unregisterTestArtifact).not.toHaveBeenCalled();
  expect(registryMocks.finishArtifactRunRegistry).not.toHaveBeenCalled();
  expect(cleanupMocks.cleanupSyntheticTestArtifactsWithStorageState).not.toHaveBeenCalled();
  expect(cleanupMocks.readLangKeyInventoryWithStorageState).not.toHaveBeenCalled();
  expect(storageMocks.removeStorageStateFile).not.toHaveBeenCalled();
});

test('same-PID foreign nonce fails before registry, cleanup, or auth-state mutation', async () => {
  registryMocks.getCurrentArtifactRun.mockReturnValue({
    version: 1,
    runId: 'run-reused-pid-owner',
    pid: process.pid,
    processNonce: 'b'.repeat(64),
    startedAt: '2026-01-01T00:00:00.000Z',
    isPidActive: true,
  });

  await expect(globalTeardown({} as FullConfig)).rejects.toThrow(
    `belongs to another process identity (recorded PID ${process.pid}, `
    + `teardown PID ${process.pid})`,
  );

  expect(registryMocks.listRegisteredTestArtifacts).not.toHaveBeenCalled();
  expect(registryMocks.unregisterTestArtifact).not.toHaveBeenCalled();
  expect(registryMocks.finishArtifactRunRegistry).not.toHaveBeenCalled();
  expect(cleanupMocks.cleanupSyntheticTestArtifactsWithStorageState).not.toHaveBeenCalled();
  expect(cleanupMocks.readLangKeyInventoryWithStorageState).not.toHaveBeenCalled();
  expect(storageMocks.removeStorageStateFile).not.toHaveBeenCalled();
});
