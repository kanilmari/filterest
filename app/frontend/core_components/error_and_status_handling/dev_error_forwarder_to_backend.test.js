// dev_error_forwarder_to_backend.test.js
// Checks recovered guard diagnostics are acknowledged before removal.
// Bridges the existing dev logger, controlled fetch and bounded session records.
// Keeps transport failures buffered and production pages silent.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const key = '__filterest_shell_boot_records_v1';
let entry;
const originalError = console.error;
let listeners;
beforeEach(() => {
    vi.resetModules(); sessionStorage.clear(); localStorage.clear();
    document.head.innerHTML = '<meta name="app-env" content="dev">';
    const guardDocument = document.implementation.createHTMLDocument();
    guardDocument.head.innerHTML = '<base href="http://localhost/">';
    guardDocument.documentElement.setAttribute('data-shell-boot-pending', '');
    const guardWindow = { location: window.location, navigator, localStorage, sessionStorage, addEventListener() {}, clearTimeout() {} };
    vm.runInNewContext(readFileSync('backend/core_components/frontend_assets/shell_boot_recovery.js', 'utf8'), { window: guardWindow, document: guardDocument });
    window.__filterestShellBoot = { status: () => ({ revealed: false }), safeRecord: guardWindow.__filterestShellBoot.safeRecord };
    entry = window.__filterestShellBoot.safeRecord({ time: Date.now(), reason: 'resource-error', resource: '/frontend/main.hash.min.js' });
    listeners = [];
    const add = window.addEventListener.bind(window);
    vi.spyOn(window, 'addEventListener').mockImplementation((name, listener, options) => { listeners.push([name, listener]); add(name, listener, options); });
});
afterEach(() => {
    listeners.forEach(([name, listener]) => window.removeEventListener(name, listener));
    console.error = originalError; delete window.__filterestShellBoot;
    vi.restoreAllMocks(); vi.unstubAllGlobals();
    window.history.replaceState({}, '', '/');
});
async function forwardWithResponse(ok) {
    sessionStorage.setItem(key, JSON.stringify([entry]));
    const fetch = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ csrf_token: 'test-csrf' }) })
        .mockResolvedValue({ ok });
    vi.stubGlobal('fetch', fetch);
    const { forwardShellBootRecords } = await import('./dev_error_forwarder_to_backend.js');
    expect(fetch).not.toHaveBeenCalled();
    window.__filterestShellBoot.status = () => ({ revealed: true });
    await forwardShellBootRecords();
    return fetch;
}
test('a 2xx reply acknowledges the diagnostic through the existing token path', async () => {
    const fetch = await forwardWithResponse(true);
    expect(JSON.parse(sessionStorage.getItem(key))).toEqual([]);
    expect(fetch.mock.calls[1][0]).toBe('/api/log-client-error');
    expect(fetch.mock.calls[1][1]).toMatchObject({ method: 'POST', credentials: 'include', headers: { 'X-CSRF-Token': 'test-csrf' } });
    expect(JSON.parse(fetch.mock.calls[1][1].body).type).toBe('shell-boot');
});
test('non-2xx keeps the exact record for a later recovered start', async () => {
    await forwardWithResponse(false);
    expect(JSON.parse(sessionStorage.getItem(key))).toEqual([entry]);
});
test('network failure keeps the exact record', async () => {
    sessionStorage.setItem(key, JSON.stringify([entry]));
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const { forwardShellBootRecords } = await import('./dev_error_forwarder_to_backend.js');
    window.__filterestShellBoot.status = () => ({ revealed: true });
    await forwardShellBootRecords();
    expect(JSON.parse(sessionStorage.getItem(key))).toEqual([entry]);
});
test('production never forwards even when explicitly imported', async () => {
    document.head.innerHTML = '<meta name="app-env" content="prod">';
    window.__filterestShellBoot.status = () => ({ revealed: true }); sessionStorage.setItem(key, JSON.stringify([entry]));
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const { forwardShellBootRecords } = await import('./dev_error_forwarder_to_backend.js');
    await forwardShellBootRecords(); window.dispatchEvent(new Event('filterest-shell-boot-recovered'));
    expect(fetch).not.toHaveBeenCalled(); expect(JSON.parse(sessionStorage.getItem(key))).toEqual([entry]);
});
test('expired entries are pruned and unsent fresh entries survive partial acknowledgement', async () => {
    const entries = [{ ...entry, time: Date.now() - 31 * 60 * 1000 }, entry, { ...entry, reason: 'ready' }];
    sessionStorage.setItem(key, JSON.stringify(entries));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ csrf_token: 'test' }) })
        .mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false }));
    const { forwardShellBootRecords } = await import('./dev_error_forwarder_to_backend.js');
    window.__filterestShellBoot.status = () => ({ revealed: true }); await forwardShellBootRecords();
    expect(JSON.parse(sessionStorage.getItem(key))).toEqual([window.__filterestShellBoot.safeRecord(entries[2])]);
});
test('replay sanitizes old private records and the persistent local buffer address', async () => {
    window.history.replaceState({}, '', '/failure?token=query-secret#fragment-secret');
    const legacy = { ...entry, message: 'password-message-secret', stack: 'response-body-secret', form: 'form-secret',
        errorName: 'custom-name-secret', source: '/module.js?token=source-secret#source-fragment', resource: '/asset.js?token=resource-secret#resource-fragment' };
    sessionStorage.setItem(key, JSON.stringify([legacy]));
    const fetch = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ csrf_token: 'test' }) }).mockResolvedValue({ ok: false });
    vi.stubGlobal('fetch', fetch);
    const { forwardShellBootRecords } = await import('./dev_error_forwarder_to_backend.js');
    window.__filterestShellBoot.status = () => ({ revealed: true }); await forwardShellBootRecords();
    const replay = fetch.mock.calls[1][1].body;
    const stored = sessionStorage.getItem(key);
    const local = localStorage.getItem('__dev_error_buffer_v1');
    for (const value of [replay, stored, local]) expect(value).not.toMatch(/secret|password|cookie|response-body|form/);
    expect(JSON.parse(local)[0].href).toBe('/failure');
    expect(JSON.parse(replay).source).toBe('/asset.js');
});
test('early transport imports cannot duplicate pending recovery errors as private generic logs', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await import('./dev_error_forwarder_to_backend.js');
    window.dispatchEvent(new ErrorEvent('error', { message: 'password-message-secret', error: new Error('response-body-secret') }));
    const rejection = new Event('unhandledrejection');
    rejection.reason = 'form-secret'; window.dispatchEvent(rejection);
    await Promise.resolve();
    expect(fetch).not.toHaveBeenCalled();
    expect(localStorage.getItem('__dev_error_buffer_v1')).toBeNull();
});
