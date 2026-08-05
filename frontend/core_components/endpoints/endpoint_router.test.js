// endpoint_router.test.js
// Verifies endpoint_router.js as the thin wrapper over the API request pipeline.
// Bridges logical route callers and mocked pipeline results to lock down request shaping.
// Exists to catch regressions in context wiring, raw URL access, and abort handling.

import { describe, test, expect, beforeEach, vi } from 'vitest';

const runApiPipeline = vi.fn();
const getEndpointUrl = vi.fn();

async function loadModule() {
  vi.resetModules();
  vi.doMock('../pipeline/api_pipeline.js', () => ({
    runApiPipeline,
    getEndpointUrl,
  }));
  return import('./endpoint_router.js');
}

describe('endpoint_router', () => {
  beforeEach(() => {
    runApiPipeline.mockReset();
    getEndpointUrl.mockReset();
  });

  test('delegates raw URL lookups to getEndpointUrl', async () => {
    const mod = await loadModule();
    getEndpointUrl.mockReturnValue('/api/example');
    expect(mod.get_endpoint_url('example')).toBe('/api/example');
    expect(getEndpointUrl).toHaveBeenCalledWith('example');
  });

  test('builds the pipeline context and returns parsedData', async () => {
    runApiPipeline.mockResolvedValue({ parsedData: { ok: true } });
    const mod = await loadModule();

    const result = await mod.endpoint_router('fetchSomething', {
      method: 'POST',
      body_data: { a: 1 },
      url_params: '?page=1',
      headers: { 'X-Test': '1' },
      stream: true,
      returnResponse: true,
      suppressAuthRedirect: true,
    });

    expect(result).toEqual({ ok: true });
    expect(runApiPipeline).toHaveBeenCalledWith({
      routeName: 'fetchSomething',
      method: 'POST',
      bodyData: { a: 1 },
      urlParams: '?page=1',
      headers: { 'X-Test': '1' },
      stream: true,
      returnResponse: true,
      suppressAuthRedirect: true,
    });
  });

  test('throws the pipeline error when the pipeline aborts with an error', async () => {
    const error = new Error('boom');
    runApiPipeline.mockResolvedValue({ abort: true, error });
    const mod = await loadModule();

    await expect(mod.endpoint_router('failingRoute')).rejects.toThrow('boom');
  });

  test('throws a generated abort error when the pipeline aborts without an error object', async () => {
    runApiPipeline.mockResolvedValue({ abort: true, reason: 'auth_redirect' });
    const mod = await loadModule();

    await expect(mod.endpoint_router('failingRoute')).rejects.toThrow('Request aborted: auth_redirect');
  });
});
