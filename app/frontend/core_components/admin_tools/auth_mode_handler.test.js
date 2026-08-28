// auth_mode_handler.test.js
// Verifies frontend auth mode loading, permission caching, and button-state reads.
// Bridges auth endpoints, local/session storage, and route-permission exports under test control.
// Exists to keep login/logout mode wiring stable across startup flows.
// @vitest-environment jsdom

import { describe, test, expect, beforeEach, vi } from 'vitest';

const countThisFunctionMock = vi.fn();
const fetchAuthModesMock = vi.fn();
const fetchUserPermissionsMock = vi.fn();
const hasRoutePermissionMock = vi.fn();

async function loadModule() {
  vi.resetModules();
  vi.doMock('../dev_tools/function_counter.js', () => ({
    count_this_function: countThisFunctionMock,
  }));
  vi.doMock('../endpoints/stable_endpoint_router.js', () => ({
    fetchAuthModes: fetchAuthModesMock,
    fetchUserPermissions: fetchUserPermissionsMock,
  }));
  vi.doMock('../route_permission_checker.js', () => ({
    hasRoutePermission: hasRoutePermissionMock,
  }));
  return import('./auth_mode_handler.js');
}

describe('auth_mode_handler', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    countThisFunctionMock.mockReset();
    fetchAuthModesMock.mockReset();
    fetchUserPermissionsMock.mockReset();
    hasRoutePermissionMock.mockReset();
    vi.restoreAllMocks();
  });

  test('stores logout state, registration flag, and user permissions for logged-in users', async () => {
    fetchAuthModesMock.mockResolvedValue({
      needs_button: 'logout',
      registration_enabled: true,
      login_required_for_browse: true,
    });
    fetchUserPermissionsMock.mockResolvedValue({ endpoints: ['/ui/view/table', '/ui/admin/permissions'] });
    const mod = await loadModule();

    await mod.setAuthModes();

    expect(countThisFunctionMock).toHaveBeenCalledWith('setAuthModes');
    expect(fetchAuthModesMock).toHaveBeenCalledWith();
    expect(fetchUserPermissionsMock).toHaveBeenCalledWith();
    expect(localStorage.getItem('button_state')).toBe('logout');
    expect(localStorage.getItem('registration_enabled')).toBe('true');
    expect(localStorage.getItem('login_required_for_browse')).toBe('true');
    expect(sessionStorage.getItem('user_permissions')).toBe(
      JSON.stringify(['/ui/view/table', '/ui/admin/permissions'])
    );
  });

  test('clears cached permissions for guest mode', async () => {
    sessionStorage.setItem('user_permissions', JSON.stringify(['/ui/view/table']));
    localStorage.setItem('login_required_for_browse', 'true');
    fetchAuthModesMock.mockResolvedValue({ needs_button: 'login', registration_enabled: false });
    const mod = await loadModule();

    await mod.setAuthModes();

    expect(localStorage.getItem('button_state')).toBe('login');
    expect(localStorage.getItem('registration_enabled')).toBe('false');
    expect(localStorage.getItem('login_required_for_browse')).toBe(null);
    expect(sessionStorage.getItem('user_permissions')).toBe(null);
  });

  test('removes cached permissions when permission fetch is malformed', async () => {
    sessionStorage.setItem('user_permissions', JSON.stringify(['/ui/view/table']));
    fetchAuthModesMock.mockResolvedValue({ needs_button: 'logout' });
    fetchUserPermissionsMock.mockResolvedValue({ endpoints: 'not-an-array' });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mod = await loadModule();

    await mod.setAuthModes();

    expect(sessionStorage.getItem('user_permissions')).toBe(null);
    expect(warnSpy).toHaveBeenCalled();
  });

  test('warns when needs_button is missing or invalid', async () => {
    fetchAuthModesMock.mockResolvedValue({ needs_button: null });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mod = await loadModule();

    await mod.setAuthModes();

    expect(localStorage.getItem('button_state')).toBe(null);
    expect(warnSpy).toHaveBeenCalled();
  });

  test('re-exports hasRoutePermission from route_permission_checker', async () => {
    hasRoutePermissionMock.mockReturnValue(true);
    const mod = await loadModule();

    expect(mod.hasRoutePermission('/ui/view/table')).toBe(true);
    expect(hasRoutePermissionMock).toHaveBeenCalledWith('/ui/view/table');
  });

  test('getButtonState returns the cached value or throws when absent', async () => {
    const mod = await loadModule();
    localStorage.setItem('button_state', 'logout');
    expect(mod.getButtonState()).toBe('logout');

    localStorage.removeItem('button_state');
    expect(() => mod.getButtonState()).toThrow('button_state not found in localStorage');
  });
});
