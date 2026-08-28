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
  }));
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
    localStorage.clear();
    vi.restoreAllMocks();

    assignSpy = vi.fn();
    reloadSpy = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { ...window.location, assign: assignSpy, reload: reloadSpy, pathname: '/' },
      writable: true,
      configurable: true,
    });
  });

  test('posts a generated fingerprint to the check endpoint', async () => {
    gatherFingerprintHashMock.mockResolvedValue('abc123');
    endpointRouterMock.mockResolvedValue({});
    const mod = await loadModule();

    await mod.checkFingerprint();

    expect(endpointRouterMock).toHaveBeenCalledWith('checkFingerprint', {
      method: 'POST',
      body_data: { fingerprint: 'abc123' },
    });
  });

  test('skips session reset on rate-limited fingerprint errors', async () => {
    gatherFingerprintHashMock.mockResolvedValue('abc123');
    endpointRouterMock.mockRejectedValue({ status: 429, message: '429 too many requests' });
    const mod = await loadModule();

    await mod.checkFingerprint();

    expect(endpointRouterMock).toHaveBeenCalledTimes(1);
    expect(endpointRouterMock).not.toHaveBeenCalledWith('resetSession', expect.anything());
  });

  test('skips session reset on network-like errors', async () => {
    gatherFingerprintHashMock.mockResolvedValue('abc123');
    endpointRouterMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const mod = await loadModule();

    await mod.checkFingerprint();

    expect(endpointRouterMock).toHaveBeenCalledTimes(1);
  });

  test('skips session reset when auth redirect already handled the failure', async () => {
    gatherFingerprintHashMock.mockResolvedValue('abc123');
    endpointRouterMock.mockRejectedValue(new Error('auth_redirect'));
    const mod = await loadModule();

    await mod.checkFingerprint();

    expect(endpointRouterMock).toHaveBeenCalledTimes(1);
  });

  test('resets the session and uses SPA navigation on genuine fingerprint failures', async () => {
    gatherFingerprintHashMock.mockResolvedValue('abc123');
    endpointRouterMock
      .mockRejectedValueOnce(new Error('fingerprint mismatch'))
      .mockResolvedValueOnce({ ok: true });
    localStorage.setItem('button_state', 'logout');
    const mod = await loadModule();

    await mod.checkFingerprint();

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

  test('keeps guest users inside the SPA after a successful session reset', async () => {
    gatherFingerprintHashMock.mockResolvedValue('abc123');
    endpointRouterMock
      .mockRejectedValueOnce(new Error('fingerprint mismatch'))
      .mockResolvedValueOnce({ ok: true });
    localStorage.setItem('button_state', 'guest');
    const mod = await loadModule();

    await mod.checkFingerprint();

    expect(endpointRouterMock).toHaveBeenNthCalledWith(2, 'resetSession', {
      method: 'POST',
      returnResponse: true,
    });
    expect(publishAuthLogoutMock).toHaveBeenCalledWith({
      reason: 'session_reset',
      postLogoutPath: '/?login-entry=1',
    });
    expect(assignSpy).not.toHaveBeenCalled();
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  test('clears client auth artifacts when session reset endpoint fails', async () => {
    gatherFingerprintHashMock.mockResolvedValue('abc123');
    endpointRouterMock
      .mockRejectedValueOnce(new Error('fingerprint mismatch'))
      .mockResolvedValueOnce({ ok: false, status: 500 });
    const mod = await loadModule();

    await mod.checkFingerprint();

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

    await mod.checkFingerprint();

    expect(clearClientAuthArtifactsMock).toHaveBeenCalledTimes(1);
    expect(reloadSpy).not.toHaveBeenCalled();
    expect(assignSpy).not.toHaveBeenCalled();
  });
});
