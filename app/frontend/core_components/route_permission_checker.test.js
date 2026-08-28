// route_permission_checker.test.js
// Verifies dataset-scoped permission checks consult backend truth and cache results safely.
// Bridges sessionStorage route hints, dataset permission caching, and backend authorization.
// Exists to prevent stale cached route lists from hiding authorized UI controls.

import { beforeEach, describe, expect, test, vi } from 'vitest';

const endpointRouterMock = vi.fn();

async function loadModule() {
    vi.resetModules();
    vi.doMock('../core_components/endpoints/endpoint_router.js', () => ({
        endpoint_router: endpointRouterMock,
    }));
    return import('./route_permission_checker.js');
}

describe('route_permission_checker', () => {
    beforeEach(() => {
        sessionStorage.clear();
        endpointRouterMock.mockReset();
        vi.restoreAllMocks();
    });

    test('hasDatasetPermission checks backend when cached route permissions are stale', async () => {
        sessionStorage.setItem('user_permissions', JSON.stringify(['/ui/view/table']));
        endpointRouterMock.mockResolvedValue({ allowed: true });
        const mod = await loadModule();

        await expect(mod.hasDatasetPermission('/api/update-row', 'dev_agent_tasks')).resolves.toBe(true);
        expect(endpointRouterMock).toHaveBeenCalledWith('checkTableRight', {
            url_params: '?route=%2Fapi%2Fupdate-row&dataset=dev_agent_tasks',
        });
    });

    test('primeDatasetPermissions batches multiple dataset routes into one backend call', async () => {
        endpointRouterMock.mockResolvedValue({
            allowed_by_route: {
                '/api/update-row': true,
                '/api/delete-rows': false,
            },
        });
        const mod = await loadModule();

        await expect(mod.primeDatasetPermissions('dev_agent_tasks', [
            '/api/update-row',
            '/api/delete-rows',
            '/api/update-row',
        ])).resolves.toEqual({
            '/api/update-row': true,
            '/api/delete-rows': false,
        });

        await expect(mod.hasDatasetPermission('/api/update-row', 'dev_agent_tasks')).resolves.toBe(true);
        await expect(mod.hasDatasetPermission('/api/delete-rows', 'dev_agent_tasks')).resolves.toBe(false);

        expect(endpointRouterMock).toHaveBeenCalledTimes(1);
        expect(endpointRouterMock).toHaveBeenCalledWith('checkTableRights', {
            method: 'POST',
            body_data: {
                dataset: 'dev_agent_tasks',
                dataset_uid: '',
                routes: ['/api/update-row', '/api/delete-rows'],
            },
        });
    });

    test('primeMultipleDatasetPermissions batches multiple datasets into one backend call', async () => {
        endpointRouterMock.mockResolvedValue({
            results: [
                {
                    dataset: 'dev_agent_tasks',
                    allowed_by_route: {
                        '/api/delete-rows': true,
                    },
                },
                {
                    dataset: 'dev_agent_task_comments',
                    allowed_by_route: {
                        '/api/delete-rows': false,
                    },
                },
            ],
        });
        const mod = await loadModule();

        const results = await mod.primeMultipleDatasetPermissions([
            {
                dataset: 'dev_agent_tasks',
                routes: ['/api/delete-rows'],
            },
            {
                dataset: 'dev_agent_task_comments',
                routes: ['/api/delete-rows'],
            },
        ]);

        expect(endpointRouterMock).toHaveBeenCalledTimes(1);
        expect(endpointRouterMock).toHaveBeenCalledWith('checkTableRightsMulti', {
            method: 'POST',
            body_data: {
                items: [
                    {
                        dataset: 'dev_agent_task_comments',
                        dataset_uid: '',
                        routes: ['/api/delete-rows'],
                    },
                    {
                        dataset: 'dev_agent_tasks',
                        dataset_uid: '',
                        routes: ['/api/delete-rows'],
                    },
                ],
            },
        });
        expect(results.get('dev_agent_tasks|')).toEqual({
            '/api/delete-rows': true,
        });
        expect(results.get('dev_agent_task_comments|')).toEqual({
            '/api/delete-rows': false,
        });
        await expect(mod.hasDatasetPermission('/api/delete-rows', 'dev_agent_tasks')).resolves.toBe(true);
        await expect(mod.hasDatasetPermission('/api/delete-rows', 'dev_agent_task_comments')).resolves.toBe(false);
    });

    test('hasDatasetPermission caches dataset results by route and dataset', async () => {
        endpointRouterMock.mockResolvedValue({ allowed: false });
        const mod = await loadModule();

        await expect(mod.hasDatasetPermission('/api/update-row', 'dev_agent_tasks')).resolves.toBe(false);
        await expect(mod.hasDatasetPermission('/api/update-row', 'dev_agent_tasks')).resolves.toBe(false);

        expect(endpointRouterMock).toHaveBeenCalledTimes(1);
    });

    test('clearPermissionCache forces a fresh backend check', async () => {
        endpointRouterMock
            .mockResolvedValueOnce({ allowed: true })
            .mockResolvedValueOnce({ allowed: false });
        const mod = await loadModule();

        await expect(mod.hasDatasetPermission('/api/update-row', 'dev_agent_tasks')).resolves.toBe(true);
        mod.clearPermissionCache();
        await expect(mod.hasDatasetPermission('/api/update-row', 'dev_agent_tasks')).resolves.toBe(false);

        expect(endpointRouterMock).toHaveBeenCalledTimes(2);
    });

    test('rate-limited responses are not cached as denials', async () => {
        const rateLimitError = new Error('rate limited');
        rateLimitError.status = 429;
        rateLimitError.isRateLimited = true;

        endpointRouterMock
            .mockRejectedValueOnce(rateLimitError)
            .mockResolvedValueOnce({ allowed: false });
        const mod = await loadModule();

        await expect(mod.hasDatasetPermission('/api/update-row', 'dev_agent_tasks')).resolves.toBe(true);
        await expect(mod.hasDatasetPermission('/api/update-row', 'dev_agent_tasks')).resolves.toBe(false);

        expect(endpointRouterMock).toHaveBeenCalledTimes(2);
    });

    test('hasDatasetPermission dedupes concurrent checks for the same route and dataset', async () => {
        let resolveRequest;
        const requestPromise = new Promise((resolve) => {
            resolveRequest = resolve;
        });
        endpointRouterMock.mockReturnValue(requestPromise);
        const mod = await loadModule();

        const p1 = mod.hasDatasetPermission('/api/update-row', 'dev_agent_tasks');
        const p2 = mod.hasDatasetPermission('/api/update-row', 'dev_agent_tasks');

        expect(endpointRouterMock).toHaveBeenCalledTimes(1);

        resolveRequest({ allowed: true });
        await expect(Promise.all([p1, p2])).resolves.toEqual([true, true]);
    });

    test('clearPermissionCache prevents an in-flight request from repopulating cache', async () => {
        let resolveRequest;
        const requestPromise = new Promise((resolve) => {
            resolveRequest = resolve;
        });
        endpointRouterMock
            .mockReturnValueOnce(requestPromise)
            .mockResolvedValueOnce({ allowed: false });
        const mod = await loadModule();

        const inflight = mod.hasDatasetPermission('/api/update-row', 'dev_agent_tasks');
        mod.clearPermissionCache();
        resolveRequest({ allowed: true });
        await expect(inflight).resolves.toBe(true);

        await expect(mod.hasDatasetPermission('/api/update-row', 'dev_agent_tasks')).resolves.toBe(false);
        expect(endpointRouterMock).toHaveBeenCalledTimes(2);
    });

    test('stale in-flight cleanup does not clear a newer request for the same key', async () => {
        let resolveOldRequest;
        let resolveNewRequest;
        const oldRequestPromise = new Promise((resolve) => {
            resolveOldRequest = resolve;
        });
        const newRequestPromise = new Promise((resolve) => {
            resolveNewRequest = resolve;
        });
        endpointRouterMock
            .mockReturnValueOnce(oldRequestPromise)
            .mockReturnValueOnce(newRequestPromise);
        const mod = await loadModule();

        const oldRequest = mod.hasDatasetPermission('/api/update-row', 'dev_agent_tasks');
        mod.clearPermissionCache();

        const newRequest1 = mod.hasDatasetPermission('/api/update-row', 'dev_agent_tasks');
        const newRequest2 = mod.hasDatasetPermission('/api/update-row', 'dev_agent_tasks');
        expect(endpointRouterMock).toHaveBeenCalledTimes(2);

        resolveOldRequest({ allowed: true });
        await expect(oldRequest).resolves.toBe(true);

        const newRequest3 = mod.hasDatasetPermission('/api/update-row', 'dev_agent_tasks');
        expect(endpointRouterMock).toHaveBeenCalledTimes(2);

        resolveNewRequest({ allowed: false });
        await expect(Promise.all([newRequest1, newRequest2, newRequest3])).resolves.toEqual([false, false, false]);
    });

    test('hasDatasetPermission waits for an in-flight dataset batch instead of issuing a second request', async () => {
        let resolveBatchRequest;
        const batchPromise = new Promise((resolve) => {
            resolveBatchRequest = resolve;
        });
        endpointRouterMock.mockReturnValue(batchPromise);
        const mod = await loadModule();

        const primePromise = mod.primeDatasetPermissions('dev_agent_tasks', [
            '/api/update-row',
            '/api/delete-rows',
        ]);
        const permissionPromise = mod.hasDatasetPermission('/api/update-row', 'dev_agent_tasks');

        expect(endpointRouterMock).toHaveBeenCalledTimes(1);

        resolveBatchRequest({
            allowed_by_route: {
                '/api/update-row': true,
                '/api/delete-rows': false,
            },
        });

        await expect(permissionPromise).resolves.toBe(true);
        await expect(primePromise).resolves.toEqual({
            '/api/update-row': true,
            '/api/delete-rows': false,
        });
        expect(endpointRouterMock).toHaveBeenCalledTimes(1);
    });
});
