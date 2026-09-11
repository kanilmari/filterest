// @vitest-environment jsdom
// dataset_aliases.test.js
// Verifies dataset alias resolution uses the dedicated alias registry when possible.
// Bridges the navigation helpers, dedicated alias endpoint, and raw-name fallback behavior.
// Exists to keep the alias read-surface cutover API-first without breaking old raw dataset paths.

import { beforeEach, describe, expect, test, vi } from 'vitest';

const endpointRouterMock = vi.fn();
const hasRoutePermissionMock = vi.fn();

async function loadModule() {
    vi.resetModules();
    vi.doMock('../../endpoints/endpoint_router.js', () => ({
        endpoint_router: endpointRouterMock,
    }));
    vi.doMock('../../route_permission_checker.js', () => ({
        hasRoutePermission: hasRoutePermissionMock,
    }));
    return import('./dataset_aliases.js');
}

describe('dataset_aliases', () => {
    beforeEach(() => {
        localStorage.clear();
        endpointRouterMock.mockReset();
        hasRoutePermissionMock.mockReset();
        hasRoutePermissionMock.mockReturnValue(true);
    });

    test('uses the dedicated dataset alias endpoint as the normal source', async () => {
        localStorage.setItem('button_state', 'logout');
        endpointRouterMock.mockResolvedValue({
            raw_to_public: {
                app_service_catalog: 'service_directory',
            },
            public_to_raw: {
                service_directory: 'app_service_catalog',
            },
        });

        const {
            refreshDatasetAliasRegistry,
            getPublicDatasetName,
            getInternalDatasetName,
            buildDatasetPath,
        } = await loadModule();

        await refreshDatasetAliasRegistry();

        expect(getPublicDatasetName('app_service_catalog')).toBe('service_directory');
        expect(getInternalDatasetName('service_directory')).toBe('app_service_catalog');
        expect(buildDatasetPath('app_service_catalog')).toBe('/service_directory');
        expect(getPublicDatasetName('system_users')).toBe('system_users');
        expect(endpointRouterMock).toHaveBeenCalledWith('datasetAliases', {
            suppressAuthRedirect: true,
            suppressErrorToast: true,
        });
    });

    test('falls back to datasetNames-derived aliases when the dedicated endpoint is unavailable', async () => {
        localStorage.setItem('button_state', 'logout');
        endpointRouterMock
            .mockRejectedValueOnce(new Error('dedicated endpoint down'))
            .mockResolvedValueOnce([
            'app_orders',
            'app_customers',
            'customers',
            'system_users',
        ]);

        const {
            refreshDatasetAliasRegistry,
            getPublicDatasetName,
            getInternalDatasetName,
            buildDatasetPath,
        } = await loadModule();

        await refreshDatasetAliasRegistry();

        expect(getPublicDatasetName('app_orders')).toBe('orders');
        expect(getInternalDatasetName('orders')).toBe('app_orders');
        expect(buildDatasetPath('app_orders')).toBe('/orders');
        expect(getPublicDatasetName('app_customers')).toBe('app_customers');
        expect(getInternalDatasetName('customers')).toBe('customers');
        expect(endpointRouterMock).toHaveBeenNthCalledWith(1, 'datasetAliases', {
            suppressAuthRedirect: true,
            suppressErrorToast: true,
        });
        expect(endpointRouterMock).toHaveBeenNthCalledWith(2, 'datasetNames', {
            url_params: '?with_aliases=1',
            suppressAuthRedirect: true,
            suppressErrorToast: true,
        });
    });

    test('falls back to the hardcoded alias map when both alias endpoints are unavailable', async () => {
        localStorage.setItem('button_state', 'logout');
        endpointRouterMock.mockRejectedValue(new Error('boom'));

        const {
            refreshDatasetAliasRegistry,
            getPublicDatasetName,
            getInternalDatasetName,
            buildDatasetPath,
        } = await loadModule();

        await refreshDatasetAliasRegistry();

        expect(getPublicDatasetName('app_service_catalog')).toBe('service_catalog');
        expect(getInternalDatasetName('service_catalog')).toBe('app_service_catalog');
        expect(buildDatasetPath('app_service_catalog')).toBe('/service_catalog');
    });

    test('keeps unknown raw names unchanged', async () => {
        localStorage.setItem('button_state', 'logout');
        endpointRouterMock.mockResolvedValue({
            raw_to_public: {
                app_service_catalog: 'service_catalog',
            },
        });

        const { refreshDatasetAliasRegistry, getPublicDatasetName, getInternalDatasetName } = await loadModule();

        await refreshDatasetAliasRegistry();

        expect(getPublicDatasetName('system_users')).toBe('system_users');
        expect(getInternalDatasetName('system_users')).toBe('system_users');
    });

    test('describes automatic app aliases and opt-in system aliases in the route hint', async () => {
        const { getDatasetRouteUniquenessHint } = await loadModule();

        expect(getDatasetRouteUniquenessHint()).toContain('app_ datasets auto-reserve');
        expect(getDatasetRouteUniquenessHint()).toContain('system_ stripped aliases stay opt-in only');
    });

    test('does not hit alias endpoints when the shell is already known guest mode', async () => {
        localStorage.setItem('button_state', 'login');
        const {
            refreshDatasetAliasRegistry,
            getPublicDatasetName,
            getInternalDatasetName,
            buildDatasetPath,
        } = await loadModule();

        expect(getPublicDatasetName('app_service_catalog')).toBe('service_catalog');
        expect(getInternalDatasetName('service_catalog')).toBe('app_service_catalog');
        expect(buildDatasetPath('app_service_catalog')).toBe('/service_catalog');

        await refreshDatasetAliasRegistry();

        expect(endpointRouterMock).not.toHaveBeenCalled();
    });

    test('does not hit alias endpoints before auth state is known', async () => {
        const { refreshDatasetAliasRegistry } = await loadModule();

        await refreshDatasetAliasRegistry();

        expect(endpointRouterMock).not.toHaveBeenCalled();
    });

    test('does not hit alias endpoints for logged-in users without alias-route permissions', async () => {
        localStorage.setItem('button_state', 'logout');
        hasRoutePermissionMock.mockReturnValue(false);

        const {
            refreshDatasetAliasRegistry,
            getPublicDatasetName,
        } = await loadModule();

        await refreshDatasetAliasRegistry();

        expect(endpointRouterMock).not.toHaveBeenCalled();
        expect(getPublicDatasetName('app_service_catalog')).toBe('service_catalog');
    });

    test('reuses a fresh alias registry instead of refetching immediately', async () => {
        localStorage.setItem('button_state', 'logout');
        endpointRouterMock.mockResolvedValue({
            raw_to_public: {
                app_service_catalog: 'service_directory',
            },
        });

        const { refreshDatasetAliasRegistry } = await loadModule();

        await refreshDatasetAliasRegistry();
        await refreshDatasetAliasRegistry();

        expect(endpointRouterMock).toHaveBeenCalledTimes(1);
    });
    test('does not trust persisted login and permission hints while resolving initial routes', async () => {
        localStorage.setItem('button_state', 'logout');
        hasRoutePermissionMock.mockReturnValue(true);
        const { getPublicDatasetName, getInternalDatasetName, buildDatasetPath } = await loadModule();
        expect(getPublicDatasetName('app_service_catalog')).toBe('service_catalog');
        expect(getInternalDatasetName('service_catalog')).toBe('app_service_catalog');
        expect(buildDatasetPath('app_service_catalog')).toBe('/service_catalog');
        await Promise.resolve();
        expect(endpointRouterMock).not.toHaveBeenCalled();
    });

    test('retains usable aliases if permissions change after auth bootstrap', async () => {
        localStorage.setItem('button_state', 'logout');
        endpointRouterMock.mockRejectedValue(Object.assign(new Error('Forbidden'), { status: 403 }));
        const { refreshDatasetAliasRegistry, getInternalDatasetName } = await loadModule();
        await refreshDatasetAliasRegistry();
        expect(getInternalDatasetName('service_catalog')).toBe('app_service_catalog');
        expect(endpointRouterMock).toHaveBeenCalledTimes(2);
        for (const [, options] of endpointRouterMock.mock.calls) {
            expect(options).toMatchObject({ suppressAuthRedirect: true, suppressErrorToast: true });
        }
    });

});
