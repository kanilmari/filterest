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
const synchronizeThemePreferenceForAuthStateMock = vi.fn();

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
  vi.doMock('../theme.js', () => ({
    synchronizeThemePreferenceForAuthState: synchronizeThemePreferenceForAuthStateMock,
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
    synchronizeThemePreferenceForAuthStateMock.mockReset();
    synchronizeThemePreferenceForAuthStateMock.mockResolvedValue('system');
    vi.restoreAllMocks();
  });

  test('invalidates the session generation before awaiting delayed auth modes', async () => {
    const mod = await loadModule();
    const session = await import('../auth/session_generation_store.js');
    const generation = session.getSessionGeneration();
    let finishModes;
    fetchAuthModesMock.mockReturnValueOnce(new Promise(resolve => { finishModes = resolve; }));
    const pending = mod.setAuthModes();
    expect(session.getSessionGeneration()).toBeGreaterThan(generation);
    finishModes({ needs_button: 'login' });
    await pending;
  });

  test('stores logout state, registration flag, and user permissions for logged-in users', async () => {
    fetchAuthModesMock.mockResolvedValue({
      needs_button: 'logout',
      registration_enabled: true,
      login_required_for_browse: true,
      show_login_button: false,
      only_admin_can_login: true,
    });
    fetchUserPermissionsMock.mockResolvedValue({ endpoints: ['/ui/view/table', '/ui/admin/permissions'] });
    const mod = await loadModule();

    await mod.setAuthModes();

    expect(countThisFunctionMock).toHaveBeenCalledWith('setAuthModes');
    expect(fetchAuthModesMock).toHaveBeenCalledWith();
    expect(fetchUserPermissionsMock).toHaveBeenCalledWith();
    expect(synchronizeThemePreferenceForAuthStateMock).toHaveBeenCalledWith(true);
    expect(localStorage.getItem('button_state')).toBe('logout');
    expect(localStorage.getItem('registration_enabled')).toBe('true');
    expect(localStorage.getItem('login_required_for_browse')).toBe('true');
    expect(localStorage.getItem('show_login_button')).toBe('false');
    expect(localStorage.getItem('only_admin_can_login')).toBe('true');
    expect(sessionStorage.getItem('user_permissions')).toBe(
      JSON.stringify(['/ui/view/table', '/ui/admin/permissions'])
    );
  });

  test('clears cached permissions when an older bootstrap lacks guest grants', async () => {
    sessionStorage.setItem('user_permissions', JSON.stringify(['/ui/view/table']));
    localStorage.setItem('login_required_for_browse', 'true');
    localStorage.setItem('show_login_button', 'false');
    localStorage.setItem('only_admin_can_login', 'true');
    fetchAuthModesMock.mockResolvedValue({ needs_button: 'login', registration_enabled: false });
    const mod = await loadModule();

    await mod.setAuthModes();

    expect(localStorage.getItem('button_state')).toBe('login');
    expect(localStorage.getItem('registration_enabled')).toBe('false');
    expect(localStorage.getItem('login_required_for_browse')).toBe(null);
    expect(localStorage.getItem('show_login_button')).toBe('true');
    expect(localStorage.getItem('only_admin_can_login')).toBe('false');
    expect(sessionStorage.getItem('user_permissions')).toBe(null);
    expect(synchronizeThemePreferenceForAuthStateMock).toHaveBeenCalledWith(false);
  });

  test('guest, sign-in and sign-out replace their route sets without merging', async () => {
    const mod = await loadModule();
    fetchAuthModesMock.mockResolvedValue({ needs_button: 'login', guest_ui_endpoints: ['/ui/article/section/details'] });
    await mod.setAuthModes();
    expect(JSON.parse(sessionStorage.getItem('user_permissions'))).toEqual(['/ui/article/section/details']);
    fetchAuthModesMock.mockResolvedValue({ needs_button: 'logout', guest_ui_endpoints: ['/ui/article/section/details'] });
    fetchUserPermissionsMock.mockResolvedValue({ endpoints: ['/ui/article/section/attachments'] });
    await mod.setAuthModes();
    expect(JSON.parse(sessionStorage.getItem('user_permissions'))).toEqual(['/ui/article/section/attachments']);
    fetchAuthModesMock.mockResolvedValue({ needs_button: 'login', guest_ui_endpoints: ['/ui/article/section/details'] });
    await mod.setAuthModes();
    expect(JSON.parse(sessionStorage.getItem('user_permissions'))).toEqual(['/ui/article/section/details']);
    expect(fetchUserPermissionsMock).toHaveBeenCalledTimes(1);
  });

  test.each(['guest', 'user'])('discards a delayed %s response after a newer bootstrap', async identity => {
    const mod = await loadModule();
    let finish;
    if (identity === 'guest') {
      fetchAuthModesMock.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    } else {
      fetchAuthModesMock.mockResolvedValueOnce({ needs_button: 'logout' });
      fetchUserPermissionsMock.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    }
    const pending = mod.setAuthModes();
    await vi.waitFor(() => expect(identity === 'guest' ? fetchAuthModesMock : fetchUserPermissionsMock).toHaveBeenCalled());
    fetchAuthModesMock.mockResolvedValueOnce({ needs_button: 'login', guest_ui_endpoints: ['/ui/current'] });
    await mod.setAuthModes();
    finish(identity === 'guest' ? { needs_button: 'login', guest_ui_endpoints: ['/ui/stale'] } : { endpoints: ['/ui/stale'] });
    await pending;
    expect(JSON.parse(sessionStorage.getItem('user_permissions'))).toEqual(['/ui/current']);
    expect(localStorage.getItem('button_state')).toBe('login');
  });

  test('session invalidation clears grants and rejects an in-flight bootstrap', async () => {
    const mod = await loadModule();
    const session = await import('../auth/session_generation_store.js');
    fetchAuthModesMock.mockResolvedValueOnce({ needs_button: 'login', guest_ui_endpoints: ['/ui/old'] });
    await mod.setAuthModes();
    let finish;
    fetchAuthModesMock.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const pending = mod.setAuthModes();
    expect(sessionStorage.getItem('user_permissions')).toBeNull();
    session.invalidateSessionGeneration({ reason: 'logout' });
    finish({ needs_button: 'login', guest_ui_endpoints: ['/ui/stale'] });
    await pending;
    expect(sessionStorage.getItem('user_permissions')).toBeNull();
  });

  test('stores the two Home presentation fields and resets stale values from an older server', async () => {
    fetchAuthModesMock.mockResolvedValue({ needs_button: 'login', separate_front_page: true, display_index_html_at_startup: true,
      front_page_button_site_name: 'Configured site' });
    const mod = await loadModule();
    await mod.setAuthModes();
    expect(localStorage.getItem('separate_front_page')).toBe('true');
    const customRoot = await import('../front_page/custom_root_navigation.js');
    expect(customRoot.isCustomRootEnabled()).toBe(true);
    expect(localStorage.getItem('front_page_button_site_name')).toBe('Configured site');
    fetchAuthModesMock.mockResolvedValue({ needs_button: 'login' });
    await mod.setAuthModes();
    expect(localStorage.getItem('separate_front_page')).toBe('false');
    expect(customRoot.isCustomRootEnabled()).toBe(false);
    expect(localStorage.getItem('front_page_button_site_name')).toBe('');
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
