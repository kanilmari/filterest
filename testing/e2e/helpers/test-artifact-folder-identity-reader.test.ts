/**
 * test-artifact-folder-identity-reader.test.ts
 * Verifies two-inventory folder absence and planned-registry release decisions.
 * Exists so failed E2E folder creation cannot lose exact cleanup evidence.
 */

import type { APIRequestContext, APIResponse } from '@playwright/test';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const registryMocks = vi.hoisted(() => ({
  unregisterTestArtifact: vi.fn(),
}));

vi.mock('./test-artifact-run-registry', () => registryMocks);

import { releasePlannedFolderIfAbsent } from './test-artifact-folder-identity-reader';

function response(payload: unknown, status = 200): APIResponse {
  return {
    ok: () => status >= 200 && status < 300,
    status: () => status,
    text: async () => JSON.stringify(payload),
  } as APIResponse;
}

function requestWithInventories(treePayload: unknown, rowsPayload: unknown): APIRequestContext {
  return {
    get: vi.fn(async (url: string) =>
      url === '/api/tree_data' ? response(treePayload) : response(rowsPayload)),
  } as unknown as APIRequestContext;
}

beforeEach(() => {
  registryMocks.unregisterTestArtifact.mockReset();
});

describe('releasePlannedFolderIfAbsent', () => {
  test('unregisters only when both complete inventories prove exact absence', async () => {
    const request = requestWithInventories(
      { nodes: [] },
      { data: [], row_count: 0 },
    );

    await releasePlannedFolderIfAbsent(request, 'e2e_missing_folder');

    expect(request.get).toHaveBeenCalledTimes(2);
    expect(request.get).toHaveBeenCalledWith('/api/tree_data');
    expect(request.get).toHaveBeenCalledWith('/api/get-results', {
      params: {
        dataset: 'system_table_folders',
        folder_name: 'e2e_missing_folder',
        offset: '0',
      },
    });
    expect(registryMocks.unregisterTestArtifact).toHaveBeenCalledWith(
      'folder',
      'e2e_missing_folder',
    );
  });

  test('retains planned ownership when both inventories expose the live folder', async () => {
    const request = requestWithInventories(
      { nodes: [{ id: 'f_91', db_id: 91, name: 'e2e_live_folder' }] },
      { data: [{ id: 91, folder_name: 'e2e_live_folder' }], row_count: 1 },
    );

    await expect(releasePlannedFolderIfAbsent(request, 'e2e_live_folder'))
      .rejects.toThrow('ambiguous planned ownership and live id=91');
    expect(registryMocks.unregisterTestArtifact).not.toHaveBeenCalled();
  });

  test('fails closed when the two server inventories disagree', async () => {
    const request = requestWithInventories(
      { nodes: [{ id: 'f_92', db_id: 92, name: 'e2e_disputed_folder' }] },
      { data: [], row_count: 0 },
    );

    await expect(releasePlannedFolderIfAbsent(request, 'e2e_disputed_folder'))
      .rejects.toThrow('E2E folder inventories disagree');
    expect(registryMocks.unregisterTestArtifact).not.toHaveBeenCalled();
  });

  test('fails closed when the filtered system inventory is incomplete', async () => {
    const request = requestWithInventories(
      { nodes: [] },
      { data: [], row_count: 1 },
    );

    await expect(releasePlannedFolderIfAbsent(request, 'e2e_incomplete_folder'))
      .rejects.toThrow('Incomplete system_table_folders inventory');
    expect(registryMocks.unregisterTestArtifact).not.toHaveBeenCalled();
  });
});
