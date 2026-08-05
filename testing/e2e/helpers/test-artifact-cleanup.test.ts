/**
 * test-artifact-cleanup.test.ts
 * Verifies fail-closed identity checks and exact registered-artifact cleanup.
 * Exists to prevent prefix- or baseline-delta ownership inference from returning.
 */

// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import type { APIRequestContext } from '@playwright/test';
import type { RegisteredTestArtifact } from './test-artifact-run-registry';
import {
  cleanupSyntheticTestArtifacts,
  normalizeE2EBaseURL,
  readSyntheticArtifactBaseline,
  validateConfirmedTestArtifacts,
  validateSyntheticArtifactBaseline,
  type SyntheticArtifactBaseline,
} from './test-artifact-cleanup';

function jsonResponse(payload: unknown, status = 200) {
  return {
    ok: () => status >= 200 && status < 300,
    status: () => status,
    text: async () => JSON.stringify(payload),
  };
}

function baseline(overrides: Partial<SyntheticArtifactBaseline> = {}): SyntheticArtifactBaseline {
  return {
    runId: 'run-cleanup-unit',
    baseURL: 'https://localhost:8082',
    userId: 4,
    username: 'test_admin',
    datasets: [
      { tableUID: 100, name: 'orders' },
      { tableUID: 101, name: 'test_manual_workspace' },
    ],
    folders: [{ dbId: 41, name: 'test_manual_folder' }],
    langKeys: ['orders'],
    totalLangKeyCount: 1,
    capturedAt: '2026-07-14T00:00:00.000Z',
    ...overrides,
  };
}

function artifact(
  overrides: Partial<RegisteredTestArtifact> = {},
): RegisteredTestArtifact {
  return {
    version: 1,
    runId: 'run-cleanup-unit',
    kind: 'dataset',
    name: 'e2e_registered_exactly',
    status: 'confirmed',
    serverId: 8123,
    registeredAt: '2026-07-14T00:01:00.000Z',
    confirmedAt: '2026-07-14T00:01:01.000Z',
    registeredByPid: 123,
    ...overrides,
  };
}

describe('E2E artifact cleanup ownership', () => {
  it('canonicalizes equivalent base URLs and rejects credential-bearing targets', () => {
    expect(normalizeE2EBaseURL('https://localhost:8082/?ignored=1#hash'))
      .toBe('https://localhost:8082');
    expect(normalizeE2EBaseURL('https://localhost:8082'))
      .toBe('https://localhost:8082');
    expect(() => normalizeE2EBaseURL('https://user:secret@localhost:8082'))
      .toThrow('without embedded credentials');
  });

  it('rejects a semantically incomplete baseline', () => {
    expect(() => validateSyntheticArtifactBaseline({
      ...baseline(),
      totalLangKeyCount: 2,
    })).toThrow('language-key count does not match');
    expect(() => validateSyntheticArtifactBaseline({
      ...baseline(),
      capturedAt: 'not-a-date',
    })).toThrow('baseline is incomplete');
  });

  it('rejects planned entries and baseline collisions before cleanup', () => {
    expect(() => validateConfirmedTestArtifacts([
      artifact({ status: 'planned', confirmedAt: null }),
    ], baseline())).toThrow('to be confirmed');
    expect(() => validateConfirmedTestArtifacts([
      artifact({ name: 'test_manual_workspace' }),
    ], baseline())).toThrow('Refusing to clean baseline dataset');
    expect(() => validateConfirmedTestArtifacts([
      artifact({ name: 'renamed_orders', serverId: 100 }),
    ], baseline())).toThrow('baseline table_uid 100');
    expect(() => validateConfirmedTestArtifacts([
      artifact({ kind: 'folder', name: 'renamed_manual_folder', serverId: 41 }),
    ], baseline())).toThrow('baseline folder id 41');
    expect(() => validateConfirmedTestArtifacts([
      artifact({ kind: 'folder', name: 'e2e_folder', serverId: null }),
    ], baseline())).toThrow('missing its server id');
  });

  it('rejects conflicting stable identities inside a baseline', () => {
    expect(() => validateSyntheticArtifactBaseline(baseline({
      datasets: [
        { tableUID: 100, name: 'orders' },
        { tableUID: 100, name: 'renamed_orders' },
      ],
    }))).toThrow('conflicting names for dataset 100');
    expect(() => validateSyntheticArtifactBaseline(baseline({
      datasets: [
        { tableUID: 100, name: 'orders' },
        { tableUID: 102, name: 'orders' },
      ],
    }))).toThrow('conflicting table_uid values');
  });

  it('fails before the first request when an entry is not confirmed', async () => {
    const request = { get: vi.fn(), post: vi.fn() } as unknown as APIRequestContext;
    await expect(cleanupSyntheticTestArtifacts(
      request,
      baseline(),
      [artifact({ status: 'planned', confirmedAt: null })],
    )).rejects.toThrow('to be confirmed');
    expect(request.get).not.toHaveBeenCalled();
    expect(request.post).not.toHaveBeenCalled();
  });

  it('drops only the exact confirmed name and leaves same-prefix data untouched', async () => {
    let datasets = ['orders', 'e2e_registered_exactly', 'e2e_unregistered_same_prefix'];
    const get = vi.fn(async (url: string) => {
      if (url === '/api/user-profile') {
        return jsonResponse({ user_id: 4, username: 'test_admin' });
      }
      if (url === '/api/csrf-token') return jsonResponse({ csrf_token: 'csrf' });
      if (url === '/api/datasets') {
        return jsonResponse({ datasets: datasets.map((dataset_name) => ({ dataset_name })) });
      }
      if (url === '/api/tree_data') {
        return jsonResponse({
          nodes: datasets.map((name) => ({
            id: `t_${name}`,
            name,
            table_uid: name === 'e2e_registered_exactly' ? '8123' : '9001',
          })),
        });
      }
      if (url === '/api/translations?lang=en') return jsonResponse({ orders: 'Orders' });
      throw new Error(`Unexpected GET ${url}`);
    });
    const post = vi.fn(async (url: string, options: { data?: { dataset_name?: string } }) => {
      expect(url).toBe('/api/drop-dataset');
      expect(options.data?.dataset_name).toBe('e2e_registered_exactly');
      datasets = datasets.filter((name) => name !== options.data?.dataset_name);
      return jsonResponse({ status: 'success' });
    });
    const request = { get, post } as unknown as APIRequestContext;

    const summary = await cleanupSyntheticTestArtifacts(
      request,
      baseline(),
      [artifact()],
    );

    expect(summary.deletedDatasets).toEqual(['e2e_registered_exactly']);
    expect(summary.remainingDatasetNames).toEqual([]);
    expect(post).toHaveBeenCalledTimes(1);
    expect(datasets).toContain('e2e_unregistered_same_prefix');
  });

  it('refuses a same-name replacement with a different table_uid before cleanup POST', async () => {
    const get = vi.fn(async (url: string) => {
      if (url === '/api/user-profile') {
        return jsonResponse({ user_id: 4, username: 'test_admin' });
      }
      if (url === '/api/csrf-token') return jsonResponse({ csrf_token: 'csrf' });
      if (url === '/api/datasets') {
        return jsonResponse({ datasets: [{ dataset_name: 'e2e_registered_exactly' }] });
      }
      if (url === '/api/tree_data') {
        return jsonResponse({
          nodes: [{
            id: 't_e2e_registered_exactly',
            name: 'e2e_registered_exactly',
            table_uid: 9999,
          }],
        });
      }
      throw new Error(`Unexpected GET ${url}`);
    });
    const post = vi.fn();
    const request = { get, post } as unknown as APIRequestContext;

    await expect(cleanupSyntheticTestArtifacts(
      request,
      baseline(),
      [artifact()],
    )).rejects.toThrow(/registered table_uid=8123, current table_uid=9999/);

    expect(post).not.toHaveBeenCalled();
  });

  it('revalidates the exact table_uid immediately before a name-only delete', async () => {
    const requestOrder: string[] = [];
    let identityReadCount = 0;
    const get = vi.fn(async (url: string) => {
      requestOrder.push(`GET ${url}`);
      if (url === '/api/user-profile') {
        return jsonResponse({ user_id: 4, username: 'test_admin' });
      }
      if (url === '/api/csrf-token') return jsonResponse({ csrf_token: 'csrf' });
      if (url === '/api/datasets') {
        return jsonResponse({ datasets: [{ dataset_name: 'e2e_registered_exactly' }] });
      }
      if (url === '/api/tree_data') {
        identityReadCount += 1;
        return jsonResponse({
          nodes: [{
            id: 't_e2e_registered_exactly',
            name: 'e2e_registered_exactly',
            table_uid: identityReadCount === 1 ? 8123 : 9999,
          }],
        });
      }
      throw new Error(`Unexpected GET ${url}`);
    });
    const post = vi.fn();
    const request = { get, post } as unknown as APIRequestContext;

    await expect(cleanupSyntheticTestArtifacts(
      request,
      baseline(),
      [artifact()],
    )).rejects.toThrow(/registered table_uid=8123, current table_uid=9999/);

    expect(requestOrder.slice(0, 2)).toEqual([
      'GET /api/user-profile',
      'GET /api/csrf-token',
    ]);
    expect(identityReadCount).toBe(2);
    expect(post).not.toHaveBeenCalled();
  });

  it('does not fetch CSRF or POST when the exact registry is empty', async () => {
    const get = vi.fn(async (url: string) => {
      if (url === '/api/user-profile') {
        return jsonResponse({ user_id: 4, username: 'test_admin' });
      }
      if (url === '/api/translations?lang=en') {
        return jsonResponse({ orders: 'Orders' });
      }
      throw new Error(`Unexpected GET ${url}`);
    });
    const post = vi.fn();
    const request = { get, post } as unknown as APIRequestContext;

    await cleanupSyntheticTestArtifacts(request, baseline(), []);

    expect(get).toHaveBeenCalledTimes(2);
    expect(post).not.toHaveBeenCalled();
  });

  it('rejects a swapped authenticated identity before CSRF or cleanup POSTs', async () => {
    const get = vi.fn(async (url: string) => {
      expect(url).toBe('/api/user-profile');
      return jsonResponse({ user_id: 8, username: 'other_admin' });
    });
    const post = vi.fn();
    const request = { get, post } as unknown as APIRequestContext;

    await expect(cleanupSyntheticTestArtifacts(
      request,
      baseline(),
      [artifact()],
    )).rejects.toThrow('identity mismatch');

    expect(get).toHaveBeenCalledTimes(1);
    expect(post).not.toHaveBeenCalled();
  });

  it.each([
    { user_id: 1, username: 'guest' },
    { user_id: '4', username: 'test_admin' },
    { user_id: 4, username: '' },
  ])('rejects malformed or guest cleanup profile %# before CSRF', async (profile) => {
    const get = vi.fn(async (url: string) => {
      expect(url).toBe('/api/user-profile');
      return jsonResponse(profile);
    });
    const post = vi.fn();
    const request = { get, post } as unknown as APIRequestContext;

    await expect(cleanupSyntheticTestArtifacts(
      request,
      baseline(),
      [artifact()],
    )).rejects.toThrow('Malformed authenticated user profile');

    expect(get).toHaveBeenCalledTimes(1);
    expect(post).not.toHaveBeenCalled();
  });

  it('fails closed on malformed successful inventory responses', async () => {
    const request = {
      get: vi.fn(async (url: string) => {
        if (url === '/api/user-profile') {
          return jsonResponse({ user_id: 4, username: 'test_admin' });
        }
        if (url === '/api/datasets') return jsonResponse({});
        if (url === '/api/tree_data') return jsonResponse({ nodes: [] });
        if (url === '/api/translations?lang=en') return jsonResponse({ orders: 'Orders' });
        throw new Error(`Unexpected GET ${url}`);
      }),
      post: vi.fn(),
    } as unknown as APIRequestContext;

    await expect(readSyntheticArtifactBaseline(request, {
      runId: 'run-cleanup-unit',
      baseURL: 'https://localhost:8082',
      userId: 4,
      username: 'test_admin',
    })).rejects.toThrow('datasets must be an array');
    expect(request.post).not.toHaveBeenCalled();
  });

  it('persists dataset names together with stable table_uid values in the baseline', async () => {
    const request = {
      get: vi.fn(async (url: string) => {
        if (url === '/api/user-profile') {
          return jsonResponse({ user_id: 4, username: 'test_admin' });
        }
        if (url === '/api/datasets') {
          return jsonResponse({ datasets: [{ dataset_name: 'orders' }] });
        }
        if (url === '/api/tree_data') {
          return jsonResponse({
            nodes: [{ id: 't_orders', name: 'orders', table_uid: '100' }],
          });
        }
        if (url === '/api/translations?lang=en') {
          return jsonResponse({ orders: 'Orders' });
        }
        throw new Error(`Unexpected GET ${url}`);
      }),
      post: vi.fn(),
    } as unknown as APIRequestContext;

    const capturedBaseline = await readSyntheticArtifactBaseline(request, {
      runId: 'run-cleanup-unit',
      baseURL: 'https://localhost:8082',
      userId: 4,
      username: 'test_admin',
    });

    expect(capturedBaseline.datasets).toEqual([{ tableUID: 100, name: 'orders' }]);
    expect(request.post).not.toHaveBeenCalled();
  });

  it('fails baseline capture when a listed dataset has no stable table_uid', async () => {
    const request = {
      get: vi.fn(async (url: string) => {
        if (url === '/api/user-profile') {
          return jsonResponse({ user_id: 4, username: 'test_admin' });
        }
        if (url === '/api/datasets') {
          return jsonResponse({ datasets: [{ dataset_name: 'orders' }] });
        }
        if (url === '/api/tree_data') return jsonResponse({ nodes: [] });
        if (url === '/api/translations?lang=en') return jsonResponse({ orders: 'Orders' });
        throw new Error(`Unexpected GET ${url}`);
      }),
      post: vi.fn(),
    } as unknown as APIRequestContext;

    await expect(readSyntheticArtifactBaseline(request, {
      runId: 'run-cleanup-unit',
      baseURL: 'https://localhost:8082',
      userId: 4,
      username: 'test_admin',
    })).rejects.toThrow('datasets lack table_uid: orders');
    expect(request.post).not.toHaveBeenCalled();
  });
});
