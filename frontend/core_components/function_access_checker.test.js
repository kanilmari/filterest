// function_access_checker.test.js
// Verifies frontend function access checks, cached permission reads, and denial side effects.
// Bridges permission storage, function counting, and access-denied feedback with mocked dependencies.
// Exists to keep client-side function gating behavior explicit and regression-safe.

import { describe, test, expect, beforeEach, vi } from 'vitest';

const countThisFunctionMock = vi.fn();
const showAccessDeniedToastMock = vi.fn();

async function loadModule(customViews = []) {
  vi.resetModules();
  vi.doMock('../core_components/dev_tools/function_counter.js', () => ({
    count_this_function: countThisFunctionMock,
  }));
  vi.doMock('../reusable_components/notifications/toast_notification_printer.js', () => ({
    showAccessDeniedToast: showAccessDeniedToastMock,
  }));
  vi.doMock('../core_components/navigation/admin_and_user_tools/custom_view_reader.js', () => ({
    custom_views: customViews,
  }));
  return import('./function_access_checker.js');
}

describe('function_access_checker', () => {
  beforeEach(() => {
    sessionStorage.clear();
    countThisFunctionMock.mockReset();
    showAccessDeniedToastMock.mockReset();
    vi.restoreAllMocks();
  });

  test('functionAccessMiddleware counts and returns true when rights check is skipped', async () => {
    const mod = await loadModule();

    await expect(mod.functionAccessMiddleware('openModal', { skipRightsCheck: true })).resolves.toBe(true);
    expect(countThisFunctionMock).toHaveBeenCalledWith('openModal');
    expect(showAccessDeniedToastMock).not.toHaveBeenCalled();
  });

  test('check_usage_rights returns false when permissions are missing', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mod = await loadModule();

    await expect(mod.check_usage_rights('/api/delete-rows')).resolves.toBe(false);
    expect(warnSpy).toHaveBeenCalledWith('user_permissions missing from sessionStorage');
  });

  test('check_usage_rights accepts direct route matches', async () => {
    sessionStorage.setItem('user_permissions', JSON.stringify(['/api/delete-rows']));
    const mod = await loadModule();

    await expect(mod.check_usage_rights('/api/delete-rows')).resolves.toBe(true);
  });

  test('check_usage_rights maps custom views to requiredPermission routes', async () => {
    sessionStorage.setItem('user_permissions', JSON.stringify(['/ui/admin/permissions']));
    const mod = await loadModule([
      { name: 'permissions', requiredPermission: '/ui/admin/permissions' },
    ]);

    await expect(mod.check_usage_rights('permissions')).resolves.toBe(true);
  });

  test('check_usage_rights allows unmapped non-route view names through', async () => {
    sessionStorage.setItem('user_permissions', JSON.stringify([]));
    const mod = await loadModule([]);

    await expect(mod.check_usage_rights('customDashboard')).resolves.toBe(true);
  });

  test('hasCachedRouteRights returns false for bad or missing permission storage', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mod = await loadModule();

    expect(mod.hasCachedRouteRights('/ui/view/table')).toBe(false);

    sessionStorage.setItem('user_permissions', '{broken');
    expect(mod.hasCachedRouteRights('/ui/view/table')).toBe(false);
    expect(warnSpy).toHaveBeenCalled();
  });

  test('hasCachedRouteRights returns true for cached routes', async () => {
    sessionStorage.setItem('user_permissions', JSON.stringify(['/ui/view/table']));
    const mod = await loadModule();

    expect(mod.hasCachedRouteRights('/ui/view/table')).toBe(true);
  });

  test('functionAccessMiddleware shows a denial toast when rights are missing', async () => {
    sessionStorage.setItem('user_permissions', JSON.stringify([]));
    const mod = await loadModule();

    await expect(mod.functionAccessMiddleware('/api/delete-rows')).resolves.toBe(false);
    expect(showAccessDeniedToastMock).toHaveBeenCalledWith('/api/delete-rows');
  });

  test('logAndCheckAccess counts synchronously and shows toast on async denial', async () => {
    sessionStorage.setItem('user_permissions', JSON.stringify([]));
    const mod = await loadModule();

    mod.logAndCheckAccess('/api/delete-rows');
    await Promise.resolve();

    expect(countThisFunctionMock).toHaveBeenCalledWith('/api/delete-rows');
    expect(showAccessDeniedToastMock).toHaveBeenCalledWith('/api/delete-rows');
  });
});
