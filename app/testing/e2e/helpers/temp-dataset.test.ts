/**
 * temp-dataset.test.ts
 * Verifies registry lifecycle and compensation after post-create helper failures.
 * Bridges the shared helper with mocked creation, identity reads, and deletion.
 * Exists so identity/seed/cache failures cannot silently leak E2E datasets.
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
  buildTempDatasetName,
  cleanupDatasetViaRequest,
  createTempDataset,
  dropTempDataset,
} from './temp-dataset';
import { readDatasetTableUIDFromPage } from './test-artifact-dataset-identity-reader';
import { datasetTreeNode, treeResponseWithDatasetNodes } from './test-artifact-tree-fixture';

type FakePageOptions = {
  createStatus?: number;
  seedStatus?: number;
  dropStatus?: number;
  treeTableUID?: number | null;
  createBody?: unknown;
  identityReadFailures?: Error[];
};

function createFakePage(options: FakePageOptions = {}): Page {
  let currentDatasetName = '';
  const identityReadFailures = [...(options.identityReadFailures ?? [])];
  const evaluate = vi.fn(async (callback: (...args: never[]) => unknown, argument?: unknown) => {
    const source = callback.toString();
    if (source.includes('/api/tree_data')) {
      const failure = identityReadFailures.shift();
      if (failure) throw failure;
      const tableUID = options.treeTableUID === undefined ? 73 : options.treeTableUID;
      return {
        status: 200,
        ok: true,
        body: JSON.stringify(treeResponseWithDatasetNodes(
          tableUID === null || !currentDatasetName
            ? []
            : [datasetTreeNode(currentDatasetName, tableUID)],
        )),
      };
    }
    if (source.includes('/api/datasets')) {
      return {
        status: 200,
        ok: true,
        body: JSON.stringify({
          datasets: [{ dataset_name: 'fixture_current_project', folder_id: 17, is_top_level_in_current_project: true }],
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
          ? JSON.stringify(options.createBody ?? {
            dataset_name: currentDatasetName,
            table_uid: options.treeTableUID ?? 73,
          })
          : 'table created but metadata refresh failed',
      };
    }
    if (payload?.url === '/api/drop-dataset') {
      const status = options.dropStatus ?? 200;
      if (status < 300) currentDatasetName = '';
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

describe('createTempDataset request', () => {
  it('sends the columns as one ordered list, in the order the test wrote them', async () => {
    const page = createFakePage();

    await createTempDataset(page, {
      datasetName: 'e2e_column_order',
      columns: { id: 'SERIAL', zeta: 'TEXT', alpha: 'BOOLEAN' },
    });

    const createCall = vi.mocked(page.evaluate).mock.calls.find(([, argument]) =>
      (argument as { url?: string } | undefined)?.url === '/api/create_dataset');
    const payload = (createCall?.[1] as { payload?: Record<string, unknown> } | undefined)?.payload;
    expect(payload?.column_list).toEqual([
      { name: 'id', data_type: 'SERIAL' },
      { name: 'zeta', data_type: 'TEXT' },
      { name: 'alpha', data_type: 'BOOLEAN' },
    ]);
    expect(payload).not.toHaveProperty('columns');
  });
});

describe('createTempDataset compensation', () => {
  it.each(['identity lookup failed', 'identity lookup timed out'])(
    'removes the created dataset before rethrowing when %s', async (message) => {
      const failure = new Error(message);
      const page = createFakePage({ identityReadFailures: [failure] });
      const datasetName = buildTempDatasetName('e2e_failed_identity');

      await expect(createTempDataset(page, {
        datasetName,
        columns: { title: 'TEXT' },
      })).rejects.toBe(failure);

      expect(registryMocks.confirmTestArtifact).toHaveBeenCalledWith('dataset', datasetName, 73);
      const destructiveCalls = vi.mocked(page.evaluate).mock.calls.filter(([, argument]) =>
        (argument as { url?: string } | undefined)?.url === '/api/drop-dataset');
      expect(destructiveCalls).toHaveLength(1);
      expect(destructiveCalls[0][1]).toMatchObject({
        payload: { dataset_name: datasetName, confirm_dataset_name: datasetName },
      });
      expect(registryMocks.unregisterTestArtifact).toHaveBeenCalledWith('dataset', datasetName);
      expect(hydrateAuthenticatedTreeDataCache).not.toHaveBeenCalled();
      await expect(readDatasetTableUIDFromPage(page, datasetName)).resolves.toBeNull();
    },
  );

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

  it('retains confirmed ownership and both errors when the cleanup identity lookup also fails', async () => {
    const primaryError = new Error('identity lookup timed out');
    const cleanupError = new Error('cleanup identity lookup timed out');
    const page = createFakePage({ identityReadFailures: [primaryError, cleanupError] });

    const failure = await createTempDataset(page, {
      datasetName: 'e2e_failed_identity_cleanup',
      columns: { title: 'TEXT' },
    }).catch(error => error);

    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure.errors).toEqual([primaryError, cleanupError]);
    expect(registryMocks.confirmTestArtifact).toHaveBeenCalledWith(
      'dataset', 'e2e_failed_identity_cleanup', 73,
    );
    expect(registryMocks.unregisterTestArtifact).not.toHaveBeenCalled();
    expect(vi.mocked(page.evaluate).mock.calls.filter(([, argument]) =>
      (argument as { url?: string } | undefined)?.url === '/api/drop-dataset')).toHaveLength(0);
  });

  it.each([
    { dataset_name: 'another_dataset', table_uid: 73 },
    { dataset_name: 'e2e_invalid_creation_identity' },
    { dataset_name: 'e2e_invalid_creation_identity', table_uid: 0 },
    { dataset_name: 'e2e_invalid_creation_identity', table_uid: -1 },
    { dataset_name: 'e2e_invalid_creation_identity', table_uid: 1.5 },
    { dataset_name: 'e2e_invalid_creation_identity', table_uid: Number.MAX_SAFE_INTEGER + 1 },
    { dataset_name: 'e2e_invalid_creation_identity', table_uid: '73' },
  ])('never confirms or deletes a successful response with an invalid identity: %j', async (createBody) => {
    const page = createFakePage({ createBody });

    await expect(createTempDataset(page, {
      datasetName: 'e2e_invalid_creation_identity',
      columns: { title: 'TEXT' },
    })).rejects.toThrow('no matching stable identity in its creation response');

    expect(registryMocks.confirmTestArtifact).not.toHaveBeenCalled();
    expect(registryMocks.requireConfirmedTestArtifact).not.toHaveBeenCalled();
    expect(registryMocks.unregisterTestArtifact).not.toHaveBeenCalled();
    expect(vi.mocked(page.evaluate).mock.calls.filter(([, argument]) =>
      (argument as { url?: string } | undefined)?.url === '/api/drop-dataset')).toHaveLength(0);
  });

  it('refuses compensation when the live identity differs from the successful creation response', async () => {
    const datasetName = 'e2e_replaced_after_creation';
    const page = createFakePage({
      createBody: { dataset_name: datasetName, table_uid: 73 },
      treeTableUID: 74,
    });

    const failure = await createTempDataset(page, {
      datasetName,
      columns: { title: 'TEXT' },
    }).catch(error => error);

    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure.errors[0].message).toContain('created table_uid=73, current table_uid=74');
    expect(failure.errors[1].message).toContain('registered table_uid=73, current table_uid=74');
    expect(registryMocks.confirmTestArtifact).toHaveBeenCalledWith('dataset', datasetName, 73);
    expect(registryMocks.unregisterTestArtifact).not.toHaveBeenCalled();
    expect(vi.mocked(page.evaluate).mock.calls.filter(([, argument]) =>
      (argument as { url?: string } | undefined)?.url === '/api/drop-dataset')).toHaveLength(0);
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
        text: () => Promise.resolve(JSON.stringify(treeResponseWithDatasetNodes([
          datasetTreeNode('e2e_request_identity_mismatch', 74),
        ]))),
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
