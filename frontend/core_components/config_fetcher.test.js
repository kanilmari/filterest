// config_fetcher.test.js
// Verifies frontend config loading, caching, and fallback behavior.
// Bridges the fetchConfig endpoint wrapper and view-level sync/async readers in isolation.
// Exists to keep startup config semantics stable even when network calls fail.

import { describe, test, expect, beforeEach, vi } from 'vitest';

const endpointRouterMock = vi.fn();

async function loadModule() {
  vi.resetModules();
  vi.doMock('../core_components/endpoints/endpoint_router.js', () => ({
    endpoint_router: endpointRouterMock,
  }));
  return import('./config_fetcher.js');
}

describe('config_fetcher', () => {
  beforeEach(() => {
    endpointRouterMock.mockReset();
    vi.restoreAllMocks();
  });

  test('loads config once and reuses the cached promise/result', async () => {
    endpointRouterMock.mockResolvedValue({ default_view: 'table', theme: 'light' });
    const mod = await loadModule();

    const first = await mod.loadConfig();
    const second = await mod.loadConfig();

    expect(first).toEqual({ default_view: 'table', theme: 'light' });
    expect(second).toBe(first);
    expect(endpointRouterMock).toHaveBeenCalledTimes(1);
    expect(mod.getDefaultViewSync()).toBe('table');
    await expect(mod.getDefaultView()).resolves.toBe('table');
  });

  test('parses stringified JSON responses', async () => {
    endpointRouterMock.mockResolvedValue('{"default_view":"normal"}');
    const mod = await loadModule();

    await expect(mod.loadConfig()).resolves.toEqual({ default_view: 'normal' });
    expect(mod.getDefaultViewSync()).toBe('normal');
  });

  test('falls back to card on failures and allows retrying', async () => {
    endpointRouterMock
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ default_view: 'ticket' });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mod = await loadModule();

    await expect(mod.loadConfig()).resolves.toEqual({ default_view: 'card' });
    expect(mod.getDefaultViewSync()).toBe('card');
    await expect(mod.loadConfig()).resolves.toEqual({ default_view: 'ticket' });
    expect(endpointRouterMock).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalled();
  });

  test('reads cross-tab login sync from the canonical key and alias', async () => {
    endpointRouterMock.mockResolvedValueOnce({ cross_tab_login_sync: true });
    let mod = await loadModule();

    await expect(mod.isCrossTabLoginSyncEnabled()).resolves.toBe(true);
    expect(mod.isCrossTabLoginSyncEnabledSync()).toBe(true);

    endpointRouterMock.mockReset();
    endpointRouterMock.mockResolvedValueOnce({ concatenate_login: true });
    mod = await loadModule();

    await expect(mod.isCrossTabLoginSyncEnabled()).resolves.toBe(true);
    expect(mod.isCrossTabLoginSyncEnabledSync()).toBe(true);
  });

  test('returns a validated per-dataset default sort', async () => {
    endpointRouterMock.mockResolvedValueOnce({
      default_dataset_sorts: {
        tickets: { column: '__images_first', direction: 'desc' },
        broken: { column: 'created', direction: 'sideways' },
      },
    });
    const mod = await loadModule();

    await mod.loadConfig();

    expect(mod.getDefaultDatasetSortSync('tickets')).toEqual({
      column: '__images_first',
      direction: 'DESC',
    });
    expect(mod.getDefaultDatasetSortSync('broken')).toEqual({
      column: null,
      direction: null,
    });
    expect(mod.getDefaultDatasetSortSync('missing')).toEqual({
      column: null,
      direction: null,
    });
  });
});
