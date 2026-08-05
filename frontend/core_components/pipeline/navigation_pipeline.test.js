// navigation_pipeline.test.js
// Verifies the declarative navigation pipeline with mocked permission and rendering boundaries.
// Bridges navigation contexts and stage side effects to lock down abort and skip behavior.
// Exists to keep frontend navigation flow predictable as cross-cutting checks evolve.

import { describe, test, expect, beforeEach, vi } from 'vitest';

const updateURLMock = vi.fn();
const withLoadingIndicatorMock = vi.fn(async (_containerId, callback) => callback());
const hasRoutePermissionMock = vi.fn();
const hasDatasetPermissionMock = vi.fn();
const showAccessDeniedToastMock = vi.fn();
const canReadDatasetFromRegistryMock = vi.fn();
const hasDatasetAccessSnapshotMock = vi.fn();

async function loadModule(customViews = []) {
  vi.resetModules();
  vi.doMock('../navigation/nav_engine/query_params.js', () => ({
    updateURL: updateURLMock,
  }));
  vi.doMock('../../reusable_components/loading/loading_indicator_printer.js', () => ({
    withLoadingIndicator: withLoadingIndicatorMock,
  }));
  vi.doMock('../route_permission_checker.js', () => ({
    hasRoutePermission: hasRoutePermissionMock,
    hasDatasetPermission: hasDatasetPermissionMock,
  }));
  vi.doMock('../navigation/nav_engine/dataset_access_registry.js', () => ({
    canReadDatasetFromRegistry: canReadDatasetFromRegistryMock,
    hasDatasetAccessSnapshot: hasDatasetAccessSnapshotMock,
  }));
  vi.doMock('../../reusable_components/notifications/toast_notification_printer.js', () => ({
    showAccessDeniedToast: showAccessDeniedToastMock,
  }));
  vi.doMock('../navigation/admin_and_user_tools/custom_view_reader.js', () => ({
    custom_views: customViews,
  }));
  return import('./navigation_pipeline.js');
}

describe('navigation_pipeline', () => {
  beforeEach(() => {
    updateURLMock.mockReset();
    withLoadingIndicatorMock.mockClear();
    hasRoutePermissionMock.mockReset();
    hasDatasetPermissionMock.mockReset();
    showAccessDeniedToastMock.mockReset();
    canReadDatasetFromRegistryMock.mockReset();
    hasDatasetAccessSnapshotMock.mockReset();
    canReadDatasetFromRegistryMock.mockReturnValue(null);
    hasDatasetAccessSnapshotMock.mockReturnValue(false);
    delete window.check_manage_permissions_dirty;
  });

  test('describes the pipeline stages and enforcement flags', async () => {
    const mod = await loadModule();

    expect(mod.describeNavigationPipeline()).toEqual([
      { name: 'dirtyCheck', alwaysEnforced: false },
      { name: 'permissionCheck', alwaysEnforced: false },
      { name: 'urlUpdate', alwaysEnforced: false },
      { name: 'viewRender', alwaysEnforced: true },
    ]);
  });

  test('aborts before URL or render work when the dirty check fails', async () => {
    window.check_manage_permissions_dirty = vi.fn().mockResolvedValue(false);
    const performNavigationCore = vi.fn();
    const mod = await loadModule();

    const result = await mod.runNavigationPipeline({
      name: 'users',
      containerId: 'main',
      params: {},
      prefix: '/app',
      _performNavigationCore: performNavigationCore,
    });

    expect(result).toEqual({ abort: true, reason: 'dirty_check_failed' });
    expect(updateURLMock).not.toHaveBeenCalled();
    expect(performNavigationCore).not.toHaveBeenCalled();
  });

  test('denies API-style routes when cached route permission is missing', async () => {
    hasRoutePermissionMock.mockReturnValue(false);
    const performNavigationCore = vi.fn();
    const mod = await loadModule();

    const result = await mod.runNavigationPipeline({
      name: '/ui/view/table',
      containerId: 'main',
      _performNavigationCore: performNavigationCore,
    });

    expect(result).toEqual({ abort: true, reason: 'permission_denied' });
    expect(showAccessDeniedToastMock).toHaveBeenCalled();
    expect(performNavigationCore).not.toHaveBeenCalled();
  });

  test('checks custom view permissions via requiredPermission before rendering', async () => {
    hasRoutePermissionMock.mockReturnValue(false);
    const performNavigationCore = vi.fn();
    const mod = await loadModule([
      { name: 'permissions', requiredPermission: '/ui/admin/permissions' },
    ]);

    const result = await mod.runNavigationPipeline({
      name: 'permissions',
      containerId: 'main',
      _performNavigationCore: performNavigationCore,
    });

    expect(result).toEqual({ abort: true, reason: 'permission_denied' });
    expect(hasRoutePermissionMock).toHaveBeenCalledWith('/ui/admin/permissions');
    expect(hasDatasetPermissionMock).not.toHaveBeenCalled();
  });

  test('checks dataset permissions for non-custom dataset names', async () => {
    hasDatasetPermissionMock.mockResolvedValue(false);
    const performNavigationCore = vi.fn();
    const mod = await loadModule();

    const result = await mod.runNavigationPipeline({
      name: 'system_users',
      containerId: 'main',
      _performNavigationCore: performNavigationCore,
    });

    expect(result).toEqual({ abort: true, reason: 'permission_denied' });
    expect(hasDatasetPermissionMock).toHaveBeenCalledWith('/api/get-results', 'system_users');
    expect(performNavigationCore).not.toHaveBeenCalled();
  });

  test('skips the extra dataset permission request when datasets endpoint already marked the dataset readable', async () => {
    canReadDatasetFromRegistryMock.mockReturnValue(true);
    const performNavigationCore = vi.fn().mockResolvedValue('rendered');
    const mod = await loadModule();

    const result = await mod.runNavigationPipeline({
      name: 'app_service_catalog',
      containerId: 'dataset_container',
      _performNavigationCore: performNavigationCore,
    });

    expect(result.name).toBe('app_service_catalog');
    expect(hasDatasetPermissionMock).not.toHaveBeenCalled();
    expect(showAccessDeniedToastMock).not.toHaveBeenCalled();
  });

  test('denies missing datasets directly from the cached datasets snapshot', async () => {
    canReadDatasetFromRegistryMock.mockReturnValue(false);
    hasDatasetAccessSnapshotMock.mockReturnValue(true);
    const performNavigationCore = vi.fn();
    const mod = await loadModule();

    const result = await mod.runNavigationPipeline({
      name: 'ghost_table',
      containerId: 'dataset_container',
      _performNavigationCore: performNavigationCore,
    });

    expect(result).toEqual({ abort: true, reason: 'permission_denied' });
    expect(hasDatasetPermissionMock).not.toHaveBeenCalled();
    expect(showAccessDeniedToastMock).toHaveBeenCalledTimes(1);
  });

  test('updates the URL and renders through the loading indicator when allowed', async () => {
    hasDatasetPermissionMock.mockResolvedValue(true);
    const performNavigationCore = vi.fn().mockResolvedValue('rendered');
    const mod = await loadModule();

    const result = await mod.runNavigationPipeline({
      name: 'system_users',
      params: { page: 2 },
      prefix: '/app',
      containerId: 'dataset_container',
      loadFunction: 'loader',
      groupName: 'datasets',
      isCustomView: false,
      _performNavigationCore: performNavigationCore,
    });

    expect(result.name).toBe('system_users');
    expect(updateURLMock).toHaveBeenCalledWith('system_users', { page: 2 }, '/app');
    expect(withLoadingIndicatorMock).toHaveBeenCalledWith(
      'dataset_container',
      expect.any(Function)
    );
    expect(performNavigationCore).toHaveBeenCalledWith(
      'system_users',
      'dataset_container',
      'loader',
      'datasets',
      false
    );
  });

  test('allows skipping urlUpdate while still enforcing viewRender', async () => {
    hasDatasetPermissionMock.mockResolvedValue(true);
    const performNavigationCore = vi.fn();
    const mod = await loadModule();

    await mod.runNavigationPipeline({
      name: 'system_users',
      containerId: 'dataset_container',
      skip: ['urlUpdate', 'viewRender'],
      _performNavigationCore: performNavigationCore,
    });

    expect(updateURLMock).not.toHaveBeenCalled();
    expect(performNavigationCore).toHaveBeenCalledTimes(1);
  });
});
