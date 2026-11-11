// @vitest-environment jsdom
// Exercises the real router and navigation registry with a fake clock and a local fetch stub.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

let route, registry, sessions, wire;
const catalogue = { datasets: [{ dataset_name: 'app_services', table_uid: 9 }] };
function answer(status, retryAfter = null) {
    const headers = { 'Content-Type': 'application/json' };
    if (retryAfter !== null) headers['Retry-After'] = retryAfter;
    return new Response(JSON.stringify(status === 200 ? catalogue : {}), { status, headers });
}
function read(options) {
    return route('fetchContentTables', { suppressErrorToast: true, ...options });
}
beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-08T05:00:00Z'));
    sessionStorage.removeItem('dataset_catalogue_retry_after_v1');
    vi.resetModules();
    wire = vi.fn();
    vi.stubGlobal('fetch', wire);
    ({ endpoint_router: route } = await import('../endpoints/endpoint_router.js'));
    registry = await import('../navigation/nav_engine/dataset_access_registry.js');
    sessions = await import('../auth/session_generation_store.js');
});
afterEach(() => {
    sessions.invalidateSessionGeneration({ reason: 'logout' });
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

test.each(['1800', 'Sun, 08 Nov 2026 05:30:00 GMT'])('a cold catalogue waits the full Retry-After (%s), then publishes a 200', async header => {
    wire.mockResolvedValueOnce(answer(429, header)).mockResolvedValueOnce(answer(200));
    const failures = await Promise.allSettled([read(), read(), read()]);
    expect(failures.map(f => f.reason?.status)).toEqual([429, 429, 429]);
    await expect(read()).rejects.toMatchObject({ status: 429 });
    await vi.advanceTimersByTimeAsync(1799999);
    expect(wire).toHaveBeenCalledTimes(1);
    const recovered = new Promise(resolve => {
        const off = registry.subscribeDatasetAccessRegistry(value => {
            if (value) { off(); resolve(value); }
        });
    });
    await vi.advanceTimersByTimeAsync(1);
    expect(await recovered).toEqual(catalogue);
    expect(registry.resolveDataset({ uid: 9 }).status).toBe('found');
    expect(wire).toHaveBeenCalledTimes(2);
});

test.each([null, '1'])('four retries keep their growing minimum even with Retry-After %s', async header => {
    const times = [];
    wire.mockImplementation(() => { times.push(Date.now()); return Promise.resolve(answer(429, header)); });
    await expect(read()).rejects.toMatchObject({ isRateLimited: true });
    for (const delay of [2000, 4000, 8000, 16000]) {
        await vi.advanceTimersByTimeAsync(delay - 1);
        await expect(read()).rejects.toMatchObject({ status: 429 });
        await vi.advanceTimersByTimeAsync(1);
    }
    await vi.advanceTimersByTimeAsync(3600000);
    for (let i = 0; i < 10; i++) await expect(read()).rejects.toMatchObject({ status: 429 });
    expect(times.map(time => time - times[0])).toEqual([0, 2000, 6000, 14000, 30000]);
});

test('a full tab reload cannot shorten a server embargo; it can recover without another reload', async () => {
    wire.mockResolvedValueOnce(answer(429, '60')).mockResolvedValueOnce(answer(200));
    await expect(read()).rejects.toMatchObject({ status: 429 });
    const start = Date.now();
    expect(Number(sessionStorage.getItem('dataset_catalogue_retry_after_v1'))).toBe(start + 60000);
    vi.clearAllTimers(); // the old document no longer runs
    vi.setSystemTime(start);
    vi.resetModules();
    ({ endpoint_router: route } = await import('../endpoints/endpoint_router.js'));
    registry = await import('../navigation/nav_engine/dataset_access_registry.js');
    sessions = await import('../auth/session_generation_store.js');
    await expect(read()).rejects.toMatchObject({ status: 429 });
    await vi.advanceTimersByTimeAsync(59999);
    expect(wire).toHaveBeenCalledTimes(1);
    const next = new Promise(resolve => {
        const off = registry.subscribeDatasetAccessRegistry(value => { if (value) { off(); resolve(value); } });
    });
    await vi.advanceTimersByTimeAsync(1);
    expect(await next).toEqual(catalogue);
    expect(wire).toHaveBeenCalledTimes(2);
});

test.each([
    ['seconds', '2592000'],
    ['overflowing seconds', '9'.repeat(320)],
    ['HTTP date', 'Tue, 08 Dec 2026 05:00:00 GMT'],
])('an excessive Retry-After in %s is capped at 30 minutes', async (_kind, header) => {
    wire.mockResolvedValueOnce(answer(429, header)).mockResolvedValueOnce(answer(200));
    await expect(read()).rejects.toMatchObject({ status: 429 });
    await vi.advanceTimersByTimeAsync(1800000 - 1);
    expect(wire).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(wire).toHaveBeenCalledTimes(2);
    expect(registry.hasDatasetAccessSnapshot()).toBe(true);
});

test('reloading an old excessive deadline repairs it once without extending it on the next reload', async () => {
    const key = 'dataset_catalogue_retry_after_v1';
    const now = Date.now();
    sessionStorage.setItem(key, String(now + 30 * 86400000));
    async function reload() {
        const reloadTime = Date.now();
        vi.clearAllTimers();
        vi.setSystemTime(reloadTime);
        vi.resetModules();
        ({ endpoint_router: route } = await import('../endpoints/endpoint_router.js'));
        registry = await import('../navigation/nav_engine/dataset_access_registry.js');
        sessions = await import('../auth/session_generation_store.js');
        await expect(read()).rejects.toMatchObject({ status: 429 });
    }
    wire.mockResolvedValueOnce(answer(200));
    await reload();
    expect(Number(sessionStorage.getItem(key))).toBe(now + 1800000);
    await vi.advanceTimersByTimeAsync(60000);
    await reload();
    expect(Number(sessionStorage.getItem(key))).toBe(now + 1800000);
    await vi.advanceTimersByTimeAsync(1740000 - 1);
    expect(wire).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(wire).toHaveBeenCalledTimes(1);
    expect(registry.hasDatasetAccessSnapshot()).toBe(true);
});

test('a caller reaching the deadline before the timer shares the registry recovery request', async () => {
    wire.mockResolvedValueOnce(answer(429)).mockResolvedValueOnce(answer(200));
    await expect(read()).rejects.toMatchObject({ status: 429 });
    vi.setSystemTime(Date.now() + 2000); // the clock moved, the timer task has not run
    expect(await read()).toEqual(catalogue);
    await vi.advanceTimersByTimeAsync(0);
    expect(registry.hasDatasetAccessSnapshot()).toBe(true);
    expect(wire).toHaveBeenCalledTimes(2);
});

test('a 200 between two 429s gives the new refusal its own retry budget and clock', async () => {
    const start = Date.now();
    const times = [];
    const statuses = [429, 429, 200, 429, 200];
    wire.mockImplementation(async () => {
        times.push(Date.now() - start);
        return answer(statuses.shift(), '1');
    });
    await expect(read()).rejects.toMatchObject({ status: 429 });
    await vi.advanceTimersByTimeAsync(6000);
    expect(registry.hasDatasetAccessSnapshot()).toBe(true);
    await expect(read()).rejects.toMatchObject({ status: 429 });
    await vi.advanceTimersByTimeAsync(2000);
    expect(times).toEqual([0, 2000, 6000, 6000, 8000]);
    expect(await registry.refreshDatasetCatalogue()).toEqual(catalogue);
});

async function observeStartupSubscription() {
    // Loading real startup modules also discovers the product's optional private views.
    vi.stubGlobal('fetch', (url, ...args) => {
        if (new URL(url, location.href).pathname === '/api/product-identity') {
            return Promise.resolve(Response.json({ private_upstream: false }));
        }
        return wire(url, ...args);
    });
    const { load_tables } = await import('../admin_tools/main/table_loader_handler.js');
    const original = registry.subscribeDatasetAccessRegistry;
    const detached = vi.fn();
    const subscribed = vi.spyOn(registry, 'subscribeDatasetAccessRegistry').mockImplementation(listener => {
        const stop = original(listener);
        return () => { detached(); stop(); };
    });
    return { load_tables, subscribed, detached };
}

test('ordinary navigation releases the startup subscription before any recovery response', async () => {
    const { load_tables, subscribed, detached } = await observeStartupSubscription();
    const { writeHistoryEntry } = await import('../navigation/nav_engine/history_entry_state.js');
    wire.mockResolvedValueOnce(answer(429)).mockResolvedValueOnce(answer(200));
    history.replaceState({}, '', '/');
    expect(await load_tables()).toBeNull();
    expect(subscribed).toHaveBeenCalledTimes(1);
    writeHistoryEntry('/', {}, { replace: true }); // the static Home fallback owns the same address
    await Promise.resolve();
    expect(detached).not.toHaveBeenCalled();
    writeHistoryEntry('/elsewhere');
    await Promise.resolve();
    expect(detached).toHaveBeenCalledTimes(1);
    writeHistoryEntry('/');
    await vi.advanceTimersByTimeAsync(2000);
    expect(registry.hasDatasetAccessSnapshot()).toBe(true);
    expect(wire).toHaveBeenCalledTimes(2);
});

test('Back leaves the startup visit before its first retry', async () => {
    const { load_tables, detached } = await observeStartupSubscription();
    wire.mockResolvedValueOnce(answer(429));
    history.replaceState({}, '', '/previous');
    history.pushState({}, '', '/current');
    await load_tables();
    history.back();
    await vi.advanceTimersByTimeAsync(10);
    expect(location.pathname).toBe('/previous');
    expect(detached).toHaveBeenCalledTimes(1);
    expect(wire).toHaveBeenCalledTimes(1);
});

test('a direct login-shell visit and return release the startup subscription', async () => {
    const { load_tables, detached } = await observeStartupSubscription();
    const { navigateToLoginEntry, clearLoginEntryQueryFromUrl } = await import('../auth/login_shell_entry.js');
    wire.mockResolvedValueOnce(answer(429));
    history.replaceState({}, '', '/');
    await load_tables();
    navigateToLoginEntry('/');
    expect(location.search).toContain('login-entry');
    clearLoginEntryQueryFromUrl();
    expect(location.pathname + location.search).toBe('/');
    expect(detached).toHaveBeenCalledTimes(1);
});

test('a departure and return while the initial 429 is in flight cannot arm the old startup', async () => {
    const { load_tables, subscribed } = await observeStartupSubscription();
    const { writeHistoryEntry } = await import('../navigation/nav_engine/history_entry_state.js');
    let reply;
    wire.mockImplementationOnce(() => new Promise(resolve => { reply = resolve; }));
    const startup = load_tables();
    await vi.advanceTimersByTimeAsync(0);
    const origin = location.href;
    writeHistoryEntry('/elsewhere');
    writeHistoryEntry(origin);
    reply(answer(429));
    expect(await startup).toBeNull();
    expect(subscribed).not.toHaveBeenCalled();
});

test.each(['exhausted', '500', 'network', 'invalid catalogue'])('startup releases its subscription when recovery stops (%s)', async outcome => {
    const { load_tables, subscribed, detached } = await observeStartupSubscription();
    wire.mockResolvedValueOnce(answer(429));
    if (outcome === 'exhausted') wire.mockImplementation(() => Promise.resolve(answer(429)));
    if (outcome === '500') wire.mockResolvedValueOnce(answer(500));
    if (outcome === 'network') wire.mockRejectedValueOnce(new TypeError('Network error'));
    if (outcome === 'invalid catalogue') wire.mockResolvedValueOnce(new Response('{}'));
    expect(await load_tables()).toBeNull();
    expect(subscribed).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30000);
    expect(detached).toHaveBeenCalledTimes(1);
    expect(registry.hasDatasetAccessSnapshot()).toBe(false);
    if (outcome === 'exhausted') {
        expect(wire).toHaveBeenCalledTimes(5);
        expect(await load_tables()).toBeNull();
        expect(subscribed).toHaveBeenCalledTimes(1);
    }
});

test('a cancelled caller does not abort a concurrent reader; changing accounts cancels old recovery', async () => {
    let reply;
    wire.mockImplementationOnce(() => new Promise(resolve => { reply = resolve; }));
    const controller = new AbortController();
    const cancelled = read({ signal: controller.signal }).catch(error => error);
    const other = read();
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    expect((await cancelled).name).toBe('AbortError');
    expect(wire.mock.calls[0][1].signal.aborted).toBe(false);
    reply(answer(200));
    expect(await other).toEqual(catalogue);
    expect(wire).toHaveBeenCalledTimes(1);
    wire.mockResolvedValueOnce(answer(429, '1800'));
    await expect(read()).rejects.toMatchObject({ status: 429 });
    sessions.invalidateSessionGeneration({ reason: 'logout' });
    await vi.advanceTimersByTimeAsync(1800000);
    expect(wire).toHaveBeenCalledTimes(2);
    expect(registry.hasDatasetAccessSnapshot()).toBe(false);
});

test('visible and restored signals for the same visit do not refetch a successful catalogue', async () => {
    let visibility = 'visible';
    const getter = vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
    try {
        registry.primeDatasetAccessRegistry(catalogue);
        wire.mockImplementation(() => Promise.resolve(answer(200)));
        function show() {
            const event = new Event('pageshow');
            Object.defineProperty(event, 'persisted', { value: true });
            window.dispatchEvent(event);
            document.dispatchEvent(new Event('visibilitychange'));
        }
        show();
        await vi.advanceTimersByTimeAsync(0);
        for (let i = 0; i < 10; i++) show();
        await vi.advanceTimersByTimeAsync(0);
        expect(wire).toHaveBeenCalledTimes(1);
        visibility = 'hidden';
        document.dispatchEvent(new Event('visibilitychange'));
        visibility = 'visible';
        show();
        await vi.advanceTimersByTimeAsync(0);
        expect(wire).toHaveBeenCalledTimes(2);
    } finally { getter.mockRestore(); }
});
