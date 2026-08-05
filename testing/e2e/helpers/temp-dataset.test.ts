/**
 * temp-dataset.test.ts
 * Verifies registry lifecycle and compensation after post-create helper failures.
 * Exists so seed/cache failures cannot silently leak confirmed E2E datasets.
 */

// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Page } from '@playwright/test';

const registryMocks = vi.hoisted(() => ({
  registerTestArtifact: vi.fn(),
  confirmTestArtifact: vi.fn(),
  requireConfirmedTestArtifact: vi.fn(),
  unregisterTestArtifact: vi.fn(),
}));
const hydrateAuthenticatedTreeDataCache = vi.hoisted(() => vi.fn());

vi.mock('./test-artifact-run-registry', () => registryMocks);
vi.mock('./tree-data-cache', () => ({ hydrateAuthenticatedTreeDataCache }));
vi.mock('./navigation', () => ({
  navigateToDataset: vi.fn(),
  waitForAppReady: vi.fn(),
  waitForDataLoaded: vi.fn(),
}));

import {
  cleanupDatasetViaRequest,
  createTempDataset,
  dropTempDataset,
} from './temp-dataset';

type FakePageOptions = {
  createStatus?: number;
  seedStatus?: number;
  dropStatus?: number;
  treeTableUID?: number | null;
};

function createFakePage(options: FakePageOptions = {}): Page {
  let currentDatasetName = '';
  const evaluate = vi.fn(async (callback: (...args: never[]) => unknown, argument?: unknown) => {
    const source = callback.toString();
    if (source.includes('/api/tree_data')) {
      const tableUID = options.treeTableUID === undefined ? 73 : options.treeTableUID;
      return {
        status: 200,
        ok: true,
        body: JSON.stringify({
          nodes: tableUID === null || !currentDatasetName
            ? []
            : [{ name: currentDatasetName, table_uid: tableUID }],
        }),
      };
    }
    if (source.includes('/api/datasets')) {
      return {
        status: 200,
        ok: true,
        body: JSON.stringify({
          datasets: [{ folder_id: 17, is_top_level_in_current_project: true }],
        }),
      };
    }
    if (source.includes('/api/csrf-token')) {
      return { status: 200, ok: true, body: JSON.stringify({ csrf_token: 'csrf' }) };
    }

    const payload = argument as {
      url?: string;
      datasetName?: string;
    } | undefined;
    if (payload?.url === '/api/create_dataset') {
      currentDatasetName = String(
        (argument as { payload?: { dataset_name?: unknown } })?.payload?.dataset_name ?? '',
      );
      const status = options.createStatus ?? 201;
      return {
        status,
        ok: status >= 200 && status < 300,
        body: status === 201
          ? JSON.stringify({ status: 'success' })
          : 'table created but metadata refresh failed',
      };
    }
    if (payload?.url === '/api/drop-dataset') {
      const status = options.dropStatus ?? 200;
      return { status, ok: status < 300, body: status < 300 ? 'success' : 'drop failed' };
    }
    if (payload?.datasetName) {
      const status = options.seedStatus ?? 201;
      return { status, body: status === 201 ? 'created' : 'seed failed' };
    }
    throw new Error(`Unexpected page.evaluate call: ${source.slice(0, 120)}`);
  });

  return {
    evaluate,
    waitForTimeout: vi.fn(),
  } as unknown as Page;
}

beforeEach(() => {
  vi.clearAllMocks();
  registryMocks.requireConfirmedTestArtifact.mockReturnValue({
    kind: 'dataset',
    name: 'owned',
    status: 'confirmed',
    serverId: 73,
  });
  hydrateAuthenticatedTreeDataCache.mockResolvedValue(undefined);
});

describe('createTempDataset compensation', () => {
  it('confirms a successful create and cleans it when seeding fails', async () => {
    const page = createFakePage({ seedStatus: 500 });

    await expect(createTempDataset(page, {
      datasetName: 'e2e_seed_failure',
      columns: { title: 'TEXT' },
      seedRows: [{ title: 'row' }],
    })).rejects.toThrow();

    expect(registryMocks.registerTestArtifact).toHaveBeenCalledWith(
      'dataset',
      'e2e_seed_failure',
    );
    expect(registryMocks.confirmTestArtifact).toHaveBeenCalledWith(
      'dataset',
      'e2e_seed_failure',
      73,
    );
    expect(registryMocks.unregisterTestArtifact).toHaveBeenCalledWith(
      'dataset',
      'e2e_seed_failure',
    );
  });

  it('compensates and unregisters when cache hydration fails', async () => {
    hydrateAuthenticatedTreeDataCache.mockRejectedValueOnce(new Error('cache failed'));
    const page = createFakePage();

    await expect(createTempDataset(page, {
      datasetName: 'e2e_cache_failure',
      columns: { title: 'TEXT' },
    })).rejects.toThrow('cache failed');

    expect(registryMocks.confirmTestArtifact).toHaveBeenCalledWith(
      'dataset',
      'e2e_cache_failure',
      73,
    );
    expect(registryMocks.unregisterTestArtifact).toHaveBeenCalledWith(
      'dataset',
      'e2e_cache_failure',
    );
  });

  it('keeps registry ownership when post-create compensation fails', async () => {
    hydrateAuthenticatedTreeDataCache.mockRejectedValueOnce(new Error('cache failed'));
    const page = createFakePage({ dropStatus: 500 });

    await expect(createTempDataset(page, {
      datasetName: 'e2e_cleanup_failure',
      columns: { title: 'TEXT' },
    })).rejects.toThrow('compensation also failed');

    expect(registryMocks.confirmTestArtifact).toHaveBeenCalledWith(
      'dataset',
      'e2e_cleanup_failure',
      73,
    );
    expect(registryMocks.unregisterTestArtifact).not.toHaveBeenCalled();
  });

  it('never uses a planned record to compensate an ambiguous create', async () => {
    const page = createFakePage({ createStatus: 500 });

    await expect(createTempDataset(page, {
      datasetName: 'e2e_ambiguous_create',
      columns: { title: 'TEXT' },
    })).rejects.toThrow(/ambiguous planned ownership/);

    expect(registryMocks.confirmTestArtifact).not.toHaveBeenCalled();
    expect(registryMocks.requireConfirmedTestArtifact).not.toHaveBeenCalled();
    expect(registryMocks.unregisterTestArtifact).not.toHaveBeenCalled();
    const destructiveCalls = vi.mocked(page.evaluate).mock.calls.filter(([, argument]) =>
      (argument as { url?: string } | undefined)?.url === '/api/drop-dataset');
    expect(destructiveCalls).toHaveLength(0);
  });

  it('refuses direct page cleanup when the live table_uid differs from registry ownership', async () => {
    const page = createFakePage({ treeTableUID: 74 });
    await createTempDataset(page, {
      datasetName: 'e2e_identity_mismatch',
      columns: { title: 'TEXT' },
    });
    registryMocks.requireConfirmedTestArtifact.mockReturnValueOnce({
      kind: 'dataset',
      name: 'e2e_identity_mismatch',
      status: 'confirmed',
      serverId: 73,
    });

    await expect(dropTempDataset(page, 'e2e_identity_mismatch'))
      .rejects.toThrow(/registered table_uid=73, current table_uid=74/);

    const destructiveCalls = vi.mocked(page.evaluate).mock.calls.filter(([, argument]) =>
      (argument as { url?: string } | undefined)?.url === '/api/drop-dataset');
    expect(destructiveCalls).toHaveLength(0);
  });

  it('rejects request-scoped cleanup before any request when ownership is only planned', async () => {
    registryMocks.requireConfirmedTestArtifact.mockImplementationOnce(() => {
      throw new Error('Cannot clean planned E2E dataset without confirmed server identity');
    });
    const request = { get: vi.fn(), post: vi.fn() };

    await expect(cleanupDatasetViaRequest(
      request as never,
      'e2e_planned_request_cleanup',
    )).rejects.toThrow(/Cannot clean planned/);

    expect(request.get).not.toHaveBeenCalled();
    expect(request.post).not.toHaveBeenCalled();
  });

  it('refuses request-scoped cleanup when the live table_uid differs from registry ownership', async () => {
    registryMocks.requireConfirmedTestArtifact.mockReturnValueOnce({
      kind: 'dataset',
      name: 'e2e_request_identity_mismatch',
      status: 'confirmed',
      serverId: 73,
    });
    const request = {
      get: vi.fn().mockResolvedValue({
        ok: () => true,
        status: () => 200,
        text: () => Promise.resolve(JSON.stringify({
          nodes: [{ name: 'e2e_request_identity_mismatch', table_uid: 74 }],
        })),
      }),
      post: vi.fn(),
    };

    await expect(cleanupDatasetViaRequest(
      request as never,
      'e2e_request_identity_mismatch',
    )).rejects.toThrow(/registered table_uid=73, current table_uid=74/);

    expect(request.get).toHaveBeenCalledTimes(1);
    expect(request.post).not.toHaveBeenCalled();
  });
});
