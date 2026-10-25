// fingerprint_checker.test.js
// Verifies fingerprint validation error handling and session-reset branching.
// Bridges browser fingerprint generation and endpoint calls with mocked startup conditions.
// Exists to keep startup auth protection stable without causing reload loops.
// @vitest-environment jsdom

import { describe, test, expect, beforeEach, vi } from 'vitest';

const gatherFingerprintHashMock = vi.fn();
const endpointRouterMock = vi.fn();
const clearClientAuthArtifactsMock = vi.fn().mockResolvedValue(undefined);
const navigateToLoginEntryMock = vi.fn();
const publishAuthLogoutMock = vi.fn();
const fetchAuthModesMock = vi.fn();
const fetchUserPermissionsMock = vi.fn();

async function loadModule() {
  vi.resetModules();
  vi.doMock('../../reusable_components/browser_identity_builder.js', () => ({
    gather_browser_fingerprint_hash: gatherFingerprintHashMock,
  }));
  vi.doMock('../endpoints/endpoint_router.js', () => ({
    endpoint_router: endpointRouterMock,
  }));
  vi.doMock('./logout_shell_reset.js', () => ({
    clearClientAuthArtifacts: clearClientAuthArtifactsMock,
  }));
  vi.doMock('./login_shell_entry.js', () => ({
    navigateToLoginEntry: navigateToLoginEntryMock,
    buildLoginEntryPath: (redirectUrl = '') => {
      const params = new URLSearchParams();
      params.set('login-entry', '1');
      if (redirectUrl) {
        params.set('redirect', redirectUrl);
      }
      return `/?${params.toString()}`;
    },
  }));
  vi.doMock('./auth_broadcast.js', () => ({
    publishAuthLogout: publishAuthLogoutMock,
    subscribeToAuthBroadcast: vi.fn(() => () => {}),
  }));
  vi.doMock('../endpoints/stable_endpoint_router.js', () => ({
    fetchAuthModes: fetchAuthModesMock, fetchUserPermissions: fetchUserPermissionsMock,
  }));
  vi.doMock('../dev_tools/function_counter.js', () => ({ count_this_function: vi.fn() }));
  vi.doMock('../route_permission_checker.js', () => ({ hasRoutePermission: vi.fn() }));
  vi.doMock('../theme.js', () => ({ synchronizeThemePreferenceForAuthState: vi.fn().mockResolvedValue('system') }));
  return import('./fingerprint_checker.js');
}

describe('checkFingerprint', () => {
  let assignSpy;
  let reloadSpy;

  beforeEach(() => {
    gatherFingerprintHashMock.mockReset();
    endpointRouterMock.mockReset();
    clearClientAuthArtifactsMock.mockReset().mockResolvedValue(undefined);
    navigateToLoginEntryMock.mockReset();
    publishAuthLogoutMock.mockReset();
    fetchAuthModesMock.mockReset();
    fetchUserPermissionsMock.mockReset().mockResolvedValue({ endpoints: [] });
    sessionStorage.clear();
    localStorage.clear();
    localStorage.setItem('button_state', 'logout');
    vi.restoreAllMocks();

    assignSpy = vi.fn();
    reloadSpy = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { ...window.location, assign: assignSpy, reload: reloadSpy, pathname: '/' },
      writable: true,
      configurable: true,
    });
  });

  test.each(['login', 'logout'])('boot uses the existing auth-modes response (%s) without another request', async (needsButton) => {
    fetchAuthModesMock.mockResolvedValue({ needs_button: needsButton, guest_ui_endpoints: [] });
    gatherFingerprintHashMock.mockResolvedValue('abc123');
    endpointRouterMock.mockResolvedValue({});
    const { checkFingerprint } = await loadModule();
    const { setAuthModes } = await import('../admin_tools/auth_mode_handler.js');

    const bootButtonState = await setAuthModes();
    await checkFingerprint(bootButtonState);

    expect(fetchAuthModesMock).toHaveBeenCalledTimes(1);
    expect(gatherFingerprintHashMock).toHaveBeenCalledTimes(needsButton === 'logout' ? 1 : 0);
    expect(endpointRouterMock).toHaveBeenCalledTimes(needsButton === 'logout' ? 1 : 0);
  });

  test.each([undefined, { needs_button: 'unknown' }, new TypeError('Failed to fetch')])(
    'unconfirmed boot never reuses a persisted signed-in flag (%s)', async (reply) => {
      localStorage.setItem('button_state', 'logout');
      if (reply instanceof Error) fetchAuthModesMock.mockRejectedValue(reply);
      else fetchAuthModesMock.mockResolvedValue(reply);
      const { checkFingerprint } = await loadModule();
      const { setAuthModes } = await import('../admin_tools/auth_mode_handler.js');
      const bootButtonState = await setAuthModes();

      await checkFingerprint(bootButtonState);

      expect(gatherFingerprintHashMock).not.toHaveBeenCalled();
      expect(endpointRouterMock).not.toHaveBeenCalled();
    });

  test('confirmed sign-in still checks when later theme setup fails', async () => {
    fetchAuthModesMock.mockResolvedValue({ needs_button: 'logout' });
    gatherFingerprintHashMock.mockResolvedValue('abc123');
    endpointRouterMock.mockResolvedValue({});
    const { checkFingerprint } = await loadModule();
    const theme = await import('../theme.js');
    theme.synchronizeThemePreferenceForAuthState.mockRejectedValue(new Error('theme unavailable'));
    const { setAuthModes } = await import('../admin_tools/auth_mode_handler.js');

    await checkFingerprint(await setAuthModes());

    expect(gatherFingerprintHashMock).toHaveBeenCalledTimes(1);
    expect(endpointRouterMock).toHaveBeenCalledTimes(1);
  });

  test('signed-in boot reads and posts a generated fingerprint to the check endpoint', async () => {
    gatherFingerprintHashMock.mockResolvedValue('abc123');
    endpointRouterMock.mockResolvedValue({});
    const mod = await loadModule();

    await mod.checkFingerprint('logout');

    expect(gatherFingerprintHashMock).toHaveBeenCalledTimes(1);
    expect(endpointRouterMock).toHaveBeenCalledWith('checkFingerprint', {
      method: 'POST',
      body_data: { fingerprint: 'abc123' },
    });
  });

  test('skips session reset on rate-limited fingerprint errors', async () => {
    gatherFingerprintHashMock.mockResolvedValue('abc123');
    endpointRouterMock.mockRejectedValue({ status: 429, message: '429 too many requests' });
    const mod = await loadModule();

    await mod.checkFingerprint('logout');

    expect(endpointRouterMock).toHaveBeenCalledTimes(1);
    expect(endpointRouterMock).not.toHaveBeenCalledWith('resetSession', expect.anything());
  });

  test('skips session reset on network-like errors', async () => {
    gatherFingerprintHashMock.mockResolvedValue('abc123');
    endpointRouterMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const mod = await loadModule();

    await mod.checkFingerprint('logout');

    expect(endpointRouterMock).toHaveBeenCalledTimes(1);
  });

  test('skips session reset when auth redirect already handled the failure', async () => {
    gatherFingerprintHashMock.mockResolvedValue('abc123');
    endpointRouterMock.mockRejectedValue(new Error('auth_redirect'));
    const mod = await loadModule();

    await mod.checkFingerprint('logout');

    expect(endpointRouterMock).toHaveBeenCalledTimes(1);
  });

  test('resets the session and uses SPA navigation on genuine fingerprint failures', async () => {
    gatherFingerprintHashMock.mockResolvedValue('abc123');
    endpointRouterMock
      .mockRejectedValueOnce(new Error('fingerprint mismatch'))
      .mockResolvedValueOnce({ ok: true });
    localStorage.setItem('button_state', 'logout');
    const mod = await loadModule();

    await mod.checkFingerprint('logout');

    expect(endpointRouterMock).toHaveBeenNthCalledWith(2, 'resetSession', {
      method: 'POST',
      returnResponse: true,
    });
    expect(publishAuthLogoutMock).toHaveBeenCalledWith({
      reason: 'session_reset',
      postLogoutPath: '/?login-entry=1',
    });
    expect(navigateToLoginEntryMock).toHaveBeenCalledTimes(1);
    expect(assignSpy).not.toHaveBeenCalled();
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  test.each(['login', 'guest', null])('guest boot (%s) never reads browser traits or posts', async (state) => {
    if (state === null) localStorage.removeItem('button_state');
    else localStorage.setItem('button_state', state);
    const mod = await loadModule();

    await mod.checkFingerprint(state);

    expect(gatherFingerprintHashMock).not.toHaveBeenCalled();
    expect(endpointRouterMock).not.toHaveBeenCalled();
    expect(clearClientAuthArtifactsMock).not.toHaveBeenCalled();
  });

  test('clears client auth artifacts when session reset endpoint fails', async () => {
    gatherFingerprintHashMock.mockResolvedValue('abc123');
    endpointRouterMock
      .mockRejectedValueOnce(new Error('fingerprint mismatch'))
      .mockResolvedValueOnce({ ok: false, status: 500 });
    const mod = await loadModule();

    await mod.checkFingerprint('logout');

    expect(clearClientAuthArtifactsMock).toHaveBeenCalledTimes(1);
    expect(reloadSpy).not.toHaveBeenCalled();
    expect(assignSpy).not.toHaveBeenCalled();
  });

  test('clears client auth artifacts when session reset endpoint throws', async () => {
    gatherFingerprintHashMock.mockResolvedValue('abc123');
    endpointRouterMock
      .mockRejectedValueOnce(new Error('fingerprint mismatch'))
      .mockRejectedValueOnce(new Error('network error'));
    const mod = await loadModule();

    await mod.checkFingerprint('logout');

    expect(clearClientAuthArtifactsMock).toHaveBeenCalledTimes(1);
    expect(reloadSpy).not.toHaveBeenCalled();
    expect(assignSpy).not.toHaveBeenCalled();
  });
});
