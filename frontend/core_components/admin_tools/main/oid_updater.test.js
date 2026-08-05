// oid_updater.test.js
// Verifies the small admin action wrapper that triggers OID refresh requests.
// Bridges the update action and mocked fetch layer to lock down logging behavior.
// Exists to keep this isolated maintenance action safe to refactor.

import { describe, test, expect, beforeEach, vi } from 'vitest';

const getEndpointUrlMock = vi.fn(() => '/api/update-oids');
const fetchMock = vi.fn();

async function loadModule() {
  vi.resetModules();
  vi.doMock('../../endpoints/endpoint_router.js', () => ({
    get_endpoint_url: getEndpointUrlMock,
  }));
  return import('./oid_updater.js');
}

describe('update_oids_and_table_names', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    getEndpointUrlMock.mockClear();
    fetchMock.mockReset();
    globalThis.fetch = fetchMock;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  test('calls endpoint without logging string responses', async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const mod = await loadModule();

    await mod.update_oids_and_table_names();

    expect(getEndpointUrlMock).toHaveBeenCalledWith('updateOids');
    expect(fetchMock).toHaveBeenCalledWith('/api/update-oids', {
      credentials: 'include',
      headers: {
        'X-Ignore-Network-Abort': '1',
      },
      signal: expect.any(AbortSignal),
    });
    expect(logSpy).not.toHaveBeenCalled();
  });

  test('warns and swallows endpoint errors', async () => {
    const error = new Error('failed');
    fetchMock.mockRejectedValue(error);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mod = await loadModule();

    await mod.update_oids_and_table_names();

    expect(warnSpy).toHaveBeenCalledWith('error updating OID values and table names:', error);
  });

  test('skips duplicate refresh calls inside the cooldown window', async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const mod = await loadModule();

    await mod.update_oids_and_table_names();
    await mod.update_oids_and_table_names();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('skips automatic refresh after the first attempt in the same tab session', async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const mod = await loadModule();

    await mod.update_oids_and_table_names();
    localStorage.removeItem('easelect_oid_refresh_started_at');
    await mod.update_oids_and_table_names();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('silently ignores abort-like maintenance failures', async () => {
    const error = new Error('aborted');
    error.name = 'AbortError';
    fetchMock.mockRejectedValue(error);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mod = await loadModule();

    await mod.update_oids_and_table_names({ force: true });

    expect(warnSpy).not.toHaveBeenCalled();
  });

  test('aborts long-running refresh requests after the safety timeout', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation((_url, options = {}) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    }));
    const mod = await loadModule();

    const refreshPromise = mod.update_oids_and_table_names({ force: true });
    await vi.advanceTimersByTimeAsync(8000);
    await refreshPromise;

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  });
});
