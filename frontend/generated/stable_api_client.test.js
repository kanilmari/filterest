// stable_api_client.test.js
// Verifies the generated standalone stable API client can be imported and exercised in isolation.
// Bridges the generated client artifact, the typed stable route subset, and a fake fetch implementation.
// Exists as a smoke test for the first #784 standalone client slice.

import { beforeEach, describe, expect, test, vi } from 'vitest';

async function loadModule() {
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn());
    return import('./stable_api_client.js');
}

function buildResponse(body, ok = true, status = 200, statusText = 'OK') {
    return {
        ok,
        status,
        statusText,
        text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    };
}

describe('stable_api_client', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    test('exports the stable client helpers and route spec metadata', async () => {
        const mod = await loadModule();

        expect(Object.keys(mod).sort()).toEqual([
            'STABLE_API_CLIENT_ROUTE_SPECS',
            'createStableApiClient',
            'fetchAuthModes',
            'fetchFKCacheTriggers',
            'fetchUserPermissions',
            'refreshFKCacheTrigger',
            'stableApiClient',
        ]);
        expect(mod.STABLE_API_CLIENT_ROUTE_SPECS.fetchAuthModes).toMatchObject({
            method: 'GET',
            path: '/api/auth-modes',
            export_name: 'fetchAuthModes',
        });
        expect(mod.STABLE_API_CLIENT_ROUTE_SPECS.fkCacheRefresh).toMatchObject({
            method: 'POST',
            path: '/api/fk-cache-refresh',
            export_name: 'refreshFKCacheTrigger',
        });
    });

    test('supports a GET request and a CSRF-backed POST request without integrating callers', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(buildResponse({ needs_button: 'logout', registration_enabled: true }))
            .mockResolvedValueOnce(buildResponse({ csrf_token: 'csrf-123' }))
            .mockResolvedValueOnce(buildResponse({ updated: 3, errors: [] }));
        const mod = await loadModule();
        const client = mod.createStableApiClient({ fetchImpl: fetchMock });

        await expect(client.fetchAuthModes()).resolves.toEqual({
            needs_button: 'logout',
            registration_enabled: true,
        });
        await expect(client.refreshFKCacheTrigger({ trigger_id: 7 })).resolves.toEqual({
            updated: 3,
            errors: [],
        });

        expect(fetchMock).toHaveBeenNthCalledWith(
            1,
            '/api/auth-modes',
            expect.objectContaining({ method: 'GET', credentials: 'include' })
        );
        expect(fetchMock).toHaveBeenNthCalledWith(
            2,
            '/api/csrf-token',
            expect.objectContaining({ method: 'GET', credentials: 'include' })
        );
        expect(fetchMock).toHaveBeenNthCalledWith(
            3,
            '/api/fk-cache-refresh',
            expect.objectContaining({
                method: 'POST',
                credentials: 'include',
                headers: expect.objectContaining({
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': 'csrf-123',
                }),
                body: JSON.stringify({ trigger_id: 7 }),
            })
        );
    });

    test('supports a requestAdapter callback that receives normalized route metadata', async () => {
        const requestAdapterMock = vi.fn()
            .mockResolvedValueOnce({ needs_button: 'logout', registration_enabled: true })
            .mockResolvedValueOnce({ updated: 3, errors: [] });
        const mod = await loadModule();
        const client = mod.createStableApiClient({ requestAdapter: requestAdapterMock });

        await expect(client.fetchAuthModes()).resolves.toEqual({
            needs_button: 'logout',
            registration_enabled: true,
        });
        await expect(client.refreshFKCacheTrigger({ trigger_id: 7 })).resolves.toEqual({
            updated: 3,
            errors: [],
        });

        expect(requestAdapterMock).toHaveBeenNthCalledWith(1, expect.objectContaining({
            routeName: 'fetchAuthModes',
            method: 'GET',
            path: '/api/auth-modes',
            body: null,
            needsCsrf: false,
            baseUrl: '',
            csrfTokenUrl: '/api/csrf-token',
            routeSpec: expect.objectContaining({
                route_name: 'fetchAuthModes',
                path: '/api/auth-modes',
                method: 'GET',
            }),
        }));
        expect(requestAdapterMock).toHaveBeenNthCalledWith(2, expect.objectContaining({
            routeName: 'fkCacheRefresh',
            method: 'POST',
            path: '/api/fk-cache-refresh',
            body: { trigger_id: 7 },
            needsCsrf: true,
            baseUrl: '',
            csrfTokenUrl: '/api/csrf-token',
            routeSpec: expect.objectContaining({
                route_name: 'fkCacheRefresh',
                path: '/api/fk-cache-refresh',
                method: 'POST',
            }),
        }));
    });

    test('supports transport as an alias for requestAdapter', async () => {
        const transportMock = vi.fn().mockResolvedValue({ endpoints: ['/ui/admin/permissions'] });
        const mod = await loadModule();
        const client = mod.createStableApiClient({ transport: transportMock });

        await expect(client.fetchUserPermissions()).resolves.toEqual({
            endpoints: ['/ui/admin/permissions'],
        });
        expect(transportMock).toHaveBeenCalledWith(expect.objectContaining({
            routeName: 'fetchUserPermissions',
            method: 'GET',
            path: '/api/user-permissions',
            body: null,
            needsCsrf: false,
        }));
    });

    test('throws a useful error for non-ok responses', async () => {
        const fetchMock = vi.fn().mockResolvedValue(buildResponse('not found', false, 404, 'Not Found'));
        const mod = await loadModule();
        const client = mod.createStableApiClient({ fetchImpl: fetchMock });

        await expect(client.fetchUserPermissions()).rejects.toThrow('HTTP 404 for GET /api/user-permissions');
    });
});
