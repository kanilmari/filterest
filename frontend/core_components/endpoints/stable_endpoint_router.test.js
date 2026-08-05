// stable_endpoint_router.test.js
// Verifies the typed stable endpoint wrappers layered on top of endpoint_router.js.
// Bridges the stable route allowlist and the generic pipeline mock with focused contract tests.
// Exists to keep Phase B hybrid migrations from silently widening back into dynamic routes.

import { beforeEach, describe, expect, test, vi } from 'vitest';

const endpointRouterMock = vi.fn();
const createStableApiClientMock = vi.fn();

async function loadModule() {
    vi.resetModules();
    vi.doUnmock('../../generated/stable_api_client.js');
    vi.doMock('./endpoint_router.js', () => ({
        endpoint_router: endpointRouterMock,
    }));
    return import('./stable_endpoint_router.js');
}

async function loadModuleWithGeneratedClientSpy() {
    vi.resetModules();
    vi.doMock('./endpoint_router.js', () => ({
        endpoint_router: endpointRouterMock,
    }));
    vi.doMock('../../generated/stable_api_client.js', () => ({
        createStableApiClient: createStableApiClientMock,
    }));
    return import('./stable_endpoint_router.js');
}

describe('stable_endpoint_router', () => {
    beforeEach(() => {
        endpointRouterMock.mockReset();
        createStableApiClientMock.mockReset();
    });

    test('rejects routes outside the typed stable inventory', async () => {
        const mod = await loadModule();

        await expect(mod.stable_endpoint_router('getResults')).rejects.toThrow(
            'Route "getResults" is outside the typed stable API island'
        );
        expect(endpointRouterMock).not.toHaveBeenCalled();
    });

    test('fetchAuthModes delegates through endpoint_router with the stable route name', async () => {
        endpointRouterMock.mockResolvedValue({ needs_button: 'login', registration_enabled: false });
        const mod = await loadModule();

        await expect(mod.fetchAuthModes()).resolves.toEqual({
            needs_button: 'login',
            registration_enabled: false,
        });
        expect(endpointRouterMock).toHaveBeenCalledWith('fetchAuthModes', { method: 'GET' });
    });

    test('creates the generated stable client with an adapter that routes live requests through endpoint_router', async () => {
        endpointRouterMock.mockResolvedValue({ needs_button: 'logout', registration_enabled: true });
        createStableApiClientMock.mockImplementation(({ requestAdapter }) => Object.freeze({
            fetchAuthModes: () => requestAdapter({
                routeSpec: {
                    route_name: 'fetchAuthModes',
                    path: '/api/auth-modes',
                    method: 'GET',
                },
                routeName: 'fetchAuthModes',
                method: 'GET',
                path: '/api/auth-modes',
                body: null,
                needsCsrf: false,
                baseUrl: '',
                csrfTokenUrl: '/api/csrf-token',
            }),
            fetchUserPermissions: vi.fn(),
            fetchFKCacheTriggers: vi.fn(),
            refreshFKCacheTrigger: vi.fn(),
        }));
        const mod = await loadModuleWithGeneratedClientSpy();

        await expect(mod.fetchAuthModes()).resolves.toEqual({
            needs_button: 'logout',
            registration_enabled: true,
        });
        expect(createStableApiClientMock).toHaveBeenCalledWith({
            requestAdapter: expect.any(Function),
        });
        expect(endpointRouterMock).toHaveBeenCalledWith('fetchAuthModes', { method: 'GET' });
    });

    test('fetchUserPermissions applies the manifest-backed GET default', async () => {
        endpointRouterMock.mockResolvedValue({ endpoints: ['/ui/admin/permissions'] });
        const mod = await loadModule();

        await expect(mod.fetchUserPermissions()).resolves.toEqual({
            endpoints: ['/ui/admin/permissions'],
        });
        expect(endpointRouterMock).toHaveBeenCalledWith('fetchUserPermissions', { method: 'GET' });
    });

    test('fetchAdminVersionInfo uses the protected candidate GET route', async () => {
        endpointRouterMock.mockResolvedValue({
            product_name: 'Filterest',
            app_version: '8.27.99',
            db_version: '8.0.55',
        });
        const mod = await loadModule();

        await expect(mod.fetchAdminVersionInfo({ suppressAuthRedirect: true })).resolves.toEqual({
            product_name: 'Filterest',
            app_version: '8.27.99',
            db_version: '8.0.55',
        });
        expect(endpointRouterMock).toHaveBeenCalledWith('adminVersionInfo', {
            method: 'GET',
            suppressAuthRedirect: true,
        });
    });

    test('refreshFKCacheTrigger posts the typed request body using the manifest-backed default method', async () => {
        endpointRouterMock.mockResolvedValue({ updated: 7, errors: [] });
        const mod = await loadModule();

        await expect(mod.refreshFKCacheTrigger({ trigger_id: 42 })).resolves.toEqual({
            updated: 7,
            errors: [],
        });
        expect(endpointRouterMock).toHaveBeenCalledWith('fkCacheRefresh', {
            method: 'POST',
            body_data: { trigger_id: 42 },
        });
    });

    test('fetchDatasetAliasManagement loads candidate-route data with the manifest-backed GET default', async () => {
        endpointRouterMock.mockResolvedValue({ datasets: [{ dataset_name: 'orders' }] });
        const mod = await loadModule();

        await expect(mod.fetchDatasetAliasManagement()).resolves.toEqual({
            datasets: [{ dataset_name: 'orders' }],
        });
        expect(endpointRouterMock).toHaveBeenCalledWith('getDatasetAliasManagement', { method: 'GET' });
    });

    test('saveDatasetAliasManagement posts the candidate alias payload through the manifest-backed POST default', async () => {
        endpointRouterMock.mockResolvedValue({ status: 'ok', message: 'Alias saved' });
        const mod = await loadModule();

        await expect(mod.saveDatasetAliasManagement({
            dataset_name: 'orders',
            alias_slug: 'shop-orders',
        })).resolves.toEqual({
            status: 'ok',
            message: 'Alias saved',
        });
        expect(endpointRouterMock).toHaveBeenCalledWith('saveDatasetAliasManagement', {
            method: 'POST',
            body_data: {
                dataset_name: 'orders',
                alias_slug: 'shop-orders',
            },
        });
    });

    test('fetchDatasetHeaderConfig loads candidate-route data with the manifest-backed GET default', async () => {
        endpointRouterMock.mockResolvedValue({ dataset_name: 'orders' });
        const mod = await loadModule();

        await expect(mod.fetchDatasetHeaderConfig('orders')).resolves.toEqual({
            dataset_name: 'orders',
        });
        expect(endpointRouterMock).toHaveBeenCalledWith('getDatasetHeaderConfig', {
            method: 'GET',
            url_params: 'orders',
        });
    });

    test('saveDatasetHeaderConfig posts multipart payloads through the candidate wrapper', async () => {
        endpointRouterMock.mockResolvedValue({ status: 'ok' });
        const mod = await loadModule();
        const payload = new FormData();
        payload.append('dataset_name', 'orders');

        await expect(mod.saveDatasetHeaderConfig(payload)).resolves.toEqual({
            status: 'ok',
        });
        expect(endpointRouterMock).toHaveBeenCalledWith('saveDatasetHeaderConfig', {
            method: 'POST',
            body_data: payload,
        });
    });

    test('fetchCardVisibility loads candidate-route data with the manifest-backed GET default', async () => {
        endpointRouterMock.mockResolvedValue({ columns: [{ column_uid: 9, column_name: 'title' }] });
        const mod = await loadModule();

        await expect(mod.fetchCardVisibility('orders')).resolves.toEqual({
            columns: [{ column_uid: 9, column_name: 'title' }],
        });
        expect(endpointRouterMock).toHaveBeenCalledWith('getCardVisibility', {
            method: 'GET',
            url_params: 'orders',
        });
    });

    test('saveCardVisibility posts the candidate update payload through the manifest-backed POST default', async () => {
        endpointRouterMock.mockResolvedValue({ status: 'ok', message: 'Saved' });
        const mod = await loadModule();

        await expect(mod.saveCardVisibility({
            table_name: 'orders',
            columns: [{ column_uid: 9, column_name: 'title' }],
        })).resolves.toEqual({
            status: 'ok',
            message: 'Saved',
        });
        expect(endpointRouterMock).toHaveBeenCalledWith('updateCardVisibility', {
            method: 'POST',
            body_data: {
                table_name: 'orders',
                columns: [{ column_uid: 9, column_name: 'title' }],
            },
        });
    });

    test('listColumnViewPresets loads candidate-route data with the manifest-backed GET default', async () => {
        endpointRouterMock.mockResolvedValue([{ id: 7, preset_name: 'Compact', hidden_columns: { title: true } }]);
        const mod = await loadModule();

        await expect(mod.listColumnViewPresets('orders')).resolves.toEqual([
            { id: 7, preset_name: 'Compact', hidden_columns: { title: true } },
        ]);
        expect(endpointRouterMock).toHaveBeenCalledWith('listColumnViewPresets', {
            method: 'GET',
            url_params: 'orders',
        });
    });

    test('saveColumnViewPreset posts the candidate save payload through the manifest-backed POST default', async () => {
        endpointRouterMock.mockResolvedValue({ status: 'ok', message: 'Saved preset' });
        const mod = await loadModule();

        await expect(mod.saveColumnViewPreset({
            table_name: 'orders',
            preset_name: 'Compact',
            hidden_columns: { title: true },
        })).resolves.toEqual({
            status: 'ok',
            message: 'Saved preset',
        });
        expect(endpointRouterMock).toHaveBeenCalledWith('saveColumnViewPreset', {
            method: 'POST',
            body_data: {
                table_name: 'orders',
                preset_name: 'Compact',
                hidden_columns: { title: true },
            },
        });
    });

    test('deleteColumnViewPreset posts the candidate delete payload through the manifest-backed POST default', async () => {
        endpointRouterMock.mockResolvedValue({ status: 'ok', message: 'Deleted preset' });
        const mod = await loadModule();

        await expect(mod.deleteColumnViewPreset({ id: 7 })).resolves.toEqual({
            status: 'ok',
            message: 'Deleted preset',
        });
        expect(endpointRouterMock).toHaveBeenCalledWith('deleteColumnViewPreset', {
            method: 'POST',
            body_data: { id: 7 },
        });
    });

    test('fetchChildTabConfig loads candidate-route data with the manifest-backed GET default', async () => {
        endpointRouterMock.mockResolvedValue([{ id: 1, tab_key: 'comments', tab_order: 0, hidden: false }]);
        const mod = await loadModule();

        await expect(mod.fetchChildTabConfig('orders')).resolves.toEqual([
            { id: 1, tab_key: 'comments', tab_order: 0, hidden: false },
        ]);
        expect(endpointRouterMock).toHaveBeenCalledWith('getChildTabConfig', {
            method: 'GET',
            url_params: 'orders',
        });
    });

    test('saveChildTabConfig posts the candidate child-tab payload through the manifest-backed POST default', async () => {
        endpointRouterMock.mockResolvedValue({ status: 'ok', message: 'Saved' });
        const mod = await loadModule();

        await expect(mod.saveChildTabConfig({
            parent_table: 'orders',
            tabs: [{ id: 1, tab_key: 'comments', tab_order: 0, hidden: false }],
        })).resolves.toEqual({
            status: 'ok',
            message: 'Saved',
        });
        expect(endpointRouterMock).toHaveBeenCalledWith('saveChildTabConfig', {
            method: 'POST',
            body_data: {
                parent_table: 'orders',
                tabs: [{ id: 1, tab_key: 'comments', tab_order: 0, hidden: false }],
            },
        });
    });

    test('rejects explicit method mismatches before calling endpoint_router', async () => {
        const mod = await loadModule();

        await expect(
            mod.stable_endpoint_router('fetchAuthModes', { method: 'POST' })
        ).rejects.toThrow('Route "fetchAuthModes" only allows method(s): GET');
        expect(endpointRouterMock).not.toHaveBeenCalled();
    });
});
