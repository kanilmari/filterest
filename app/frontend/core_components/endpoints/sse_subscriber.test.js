// @vitest-environment jsdom
// sse_subscriber.test.js
// Verifies shared SSE lifecycle for guest, authenticated and ended sign-ins.
// Bridges local auth state, EventSource events, reconnects and dataset refresh timers.
// Exists to keep guests and ended sign-ins from reopening a forbidden stream.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const refreshTableUnifiedMock = vi.fn();
const getParamsMock = vi.fn();
const doIntelligentSearchMock = vi.fn();
const hasCachedSearchResultsMock = vi.fn();
const rerenderCachedSearchResultsMock = vi.fn();
const datasetSearchGetMock = vi.fn();
const eventSourceAddEventListenerMock = vi.fn();
const eventSourceCloseMock = vi.fn();
let loadedSubscriber = null;
afterEach(() => { loadedSubscriber?.clearSSEActiveDataset(); vi.useRealTimers(); });
const sessionListeners = [];
const fetchMock = vi.fn();

async function loadModule() {
    vi.resetModules();
    vi.doMock('../auth/session_generation_store.js', () => ({
        subscribeToSessionGeneration: listener => { sessionListeners.push(listener); return () => {}; },
    }));
    vi.doMock('../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js', () => ({
        refreshTableUnified: refreshTableUnifiedMock,
    }));
    vi.doMock('../navigation/nav_engine/query_params.js', () => ({
        getParams: getParamsMock,
    }));
    vi.doMock('../filterbar/text_search/dataset_search_executor.js', () => ({
        do_intelligent_search: doIntelligentSearchMock,
        hasCachedSearchResults: hasCachedSearchResultsMock,
        rerenderCachedSearchResults: rerenderCachedSearchResultsMock,
    }));
    vi.doMock('../filterbar/text_search/dataset_search_state_reader.js', () => ({
        datasetSearchState: {
            get: datasetSearchGetMock,
        },
    }));
    loadedSubscriber = await import('./sse_subscriber.js');
    return loadedSubscriber;
}

describe('sse_subscriber', () => {
    beforeEach(() => {
        localStorage.clear();
        sessionListeners.length = 0;
        fetchMock.mockReset().mockResolvedValue({ status: 503 });
        vi.stubGlobal('fetch', fetchMock);
        vi.useRealTimers();
        refreshTableUnifiedMock.mockReset();
        getParamsMock.mockReset();
        getParamsMock.mockReturnValue({});
        doIntelligentSearchMock.mockReset();
        doIntelligentSearchMock.mockResolvedValue(undefined);
        hasCachedSearchResultsMock.mockReset();
        hasCachedSearchResultsMock.mockReturnValue(false);
        rerenderCachedSearchResultsMock.mockReset();
        rerenderCachedSearchResultsMock.mockResolvedValue(undefined);
        datasetSearchGetMock.mockReset();
        datasetSearchGetMock.mockReturnValue('');
        eventSourceAddEventListenerMock.mockReset();
        eventSourceCloseMock.mockReset();
        vi.stubGlobal('EventSource', vi.fn(function EventSourceMock() {
            this.addEventListener = eventSourceAddEventListenerMock;
            this.close = eventSourceCloseMock;
            this.onopen = null;
            this.onerror = null;
        }));
    });

    test('does not open the SSE stream while the browser is in guest/login mode', async () => {
        localStorage.setItem('button_state', 'login');
        const mod = await loadModule();

        mod.setSSEActiveDataset('app_service_catalog');

        expect(globalThis.EventSource).not.toHaveBeenCalled();
        expect(mod.getSSEActiveDataset()).toBe('app_service_catalog');
    });

    test('opens the SSE stream for authenticated sessions', async () => {
        localStorage.setItem('button_state', 'logout');
        const mod = await loadModule();

        mod.setSSEActiveDataset('app_service_catalog');

        expect(globalThis.EventSource).toHaveBeenCalledWith(
            '/api/sse/subscribe?datasets=app_service_catalog'
        );
        expect(eventSourceAddEventListenerMock).toHaveBeenCalledWith(
            'session_ended', expect.any(Function)
        );
    });

    test('closes an ended sign-in stream and suppresses reconnects across navigation', async () => {
        vi.useFakeTimers();
        localStorage.setItem('button_state', 'logout');
        const mod = await loadModule();
        mod.setSSEActiveDataset('app_service_catalog');
        const source = globalThis.EventSource.mock.instances[0];
        const sessionEndedListener = eventSourceAddEventListenerMock.mock.calls
            .find(([eventName]) => eventName === 'session_ended')[1];

        sessionEndedListener({ data: '' });
        source.onerror(); // A queued transport error must not restart the stream.
        mod.setSSEActiveDataset('orders');
        window.dispatchEvent(new Event('pageshow'));
        mod.clearSSEActiveDataset();
        mod.setSSEActiveDataset('orders');
        await vi.advanceTimersByTimeAsync(30000);

        expect(eventSourceCloseMock).toHaveBeenCalledTimes(1);
        expect(globalThis.EventSource).toHaveBeenCalledTimes(1);
        expect(localStorage.getItem('button_state')).toBe('logout');
    });

    test('cancels pending refresh and reconnect timers when the sign-in ends', async () => {
        vi.useFakeTimers();
        localStorage.setItem('button_state', 'logout');
        const mod = await loadModule();
        mod.setSSEActiveDataset('orders');
        const source = globalThis.EventSource.mock.instances[0];
        const rowChangeListener = eventSourceAddEventListenerMock.mock.calls
            .find(([eventName]) => eventName === 'row_change')[1];
        const sessionEndedListener = eventSourceAddEventListenerMock.mock.calls
            .find(([eventName]) => eventName === 'session_ended')[1];

        rowChangeListener({ data: JSON.stringify({ table: 'orders' }) });
        source.onerror();
        sessionEndedListener({ data: '' });
        rowChangeListener({ data: JSON.stringify({ table: 'orders' }) });
        await vi.advanceTimersByTimeAsync(30000);

        expect(globalThis.EventSource).toHaveBeenCalledTimes(1);
        expect(refreshTableUnifiedMock).not.toHaveBeenCalled();
        expect(doIntelligentSearchMock).not.toHaveBeenCalled();
        expect(rerenderCachedSearchResultsMock).not.toHaveBeenCalled();
    });

    test('still reconnects after an ordinary transport error', async () => {
        vi.useFakeTimers();
        localStorage.setItem('button_state', 'logout');
        const mod = await loadModule();
        mod.setSSEActiveDataset('orders');
        const source = globalThis.EventSource.mock.instances[0];

        source.onerror();
        await vi.advanceTimersByTimeAsync(1000);

        expect(eventSourceCloseMock).toHaveBeenCalledTimes(1);
        expect(globalThis.EventSource).toHaveBeenCalledTimes(2);
        mod.clearSSEActiveDataset();
    });

    test('closes the active SSE stream on pagehide without starting a new one', async () => {
        localStorage.setItem('button_state', 'logout');
        const mod = await loadModule();

        mod.setSSEActiveDataset('app_service_catalog');
        window.dispatchEvent(new Event('pagehide'));

        expect(eventSourceCloseMock).toHaveBeenCalled();
        expect(globalThis.EventSource).toHaveBeenCalledTimes(1);
    });

    test('closes the active SSE stream on beforeunload without starting a new one', async () => {
        localStorage.setItem('button_state', 'logout');
        const mod = await loadModule();

        mod.setSSEActiveDataset('app_service_catalog');
        window.dispatchEvent(new Event('beforeunload'));

        expect(eventSourceCloseMock).toHaveBeenCalled();
        expect(globalThis.EventSource).toHaveBeenCalledTimes(1);
    });

    test('rerenders cached search results instead of full refresh for active search row changes', async () => {
        vi.useFakeTimers();
        localStorage.setItem('button_state', 'logout');
        datasetSearchGetMock.mockReturnValue('service_catalog');
        hasCachedSearchResultsMock.mockReturnValue(true);
        const mod = await loadModule();

        mod.setSSEActiveDataset('app_service_catalog');

        eventSourceAddEventListenerMock.mock.calls
            .find(([eventName]) => eventName === 'row_change')?.[1]?.({
                data: JSON.stringify({ table: 'app_service_catalog' }),
            });

        await vi.advanceTimersByTimeAsync(180);

        expect(rerenderCachedSearchResultsMock).toHaveBeenCalledWith('app_service_catalog');
        expect(refreshTableUnifiedMock).not.toHaveBeenCalled();
    });

    test('reruns committed dataset search instead of expanding to all rows after row changes', async () => {
        vi.useFakeTimers();
        localStorage.setItem('button_state', 'logout');
        getParamsMock.mockReturnValue({ search: 'service catalog' });
        datasetSearchGetMock.mockReturnValue('service catalog');
        hasCachedSearchResultsMock.mockReturnValue(true);
        const mod = await loadModule();

        mod.setSSEActiveDataset('app_service_catalog');

        eventSourceAddEventListenerMock.mock.calls
            .find(([eventName]) => eventName === 'row_change')?.[1]?.({
                data: JSON.stringify({ table: 'app_service_catalog' }),
            });

        await vi.advanceTimersByTimeAsync(180);

        expect(doIntelligentSearchMock).toHaveBeenCalledWith('app_service_catalog', 'service catalog');
        expect(rerenderCachedSearchResultsMock).not.toHaveBeenCalled();
        expect(refreshTableUnifiedMock).not.toHaveBeenCalled();
    });
});


describe('subscription admission', () => {
    beforeEach(() => {
        vi.stubGlobal('EventSource', vi.fn(function () { this.addEventListener = eventSourceAddEventListenerMock; this.close = eventSourceCloseMock; }));
        sessionListeners.length = 0;
        fetchMock.mockReset();
    });

test.each([401, 403])('SSE stops after HTTP %s until a verified rights refresh', async status => {
    vi.useFakeTimers();
    localStorage.setItem('button_state', 'logout');
    fetchMock.mockResolvedValue({ status });
    vi.stubGlobal('fetch', fetchMock);
    const mod = await loadModule();
    mod.setSSEActiveDataset('denied_orders');
    globalThis.EventSource.mock.instances.at(-1).onerror();
    await vi.advanceTimersByTimeAsync(60000);
    mod.setSSEActiveDataset('denied_other');
    await vi.advanceTimersByTimeAsync(60000);
    expect(globalThis.EventSource).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Visibility/focus alone never clear the denial.
    sessionListeners.at(-1)('focus');
    window.dispatchEvent(new Event('pageshow'));
    await vi.advanceTimersByTimeAsync(60000);
    expect(globalThis.EventSource).toHaveBeenCalledTimes(1);
    sessionListeners.at(-1)('login');
    expect(globalThis.EventSource).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('routePermissionsRefreshed'));
    expect(globalThis.EventSource).toHaveBeenCalledTimes(2);
    mod.clearSSEActiveDataset();
    vi.useRealTimers();
});


test('non-permission HTTP failures retain exponential backoff capped at 15 seconds', async () => {
    vi.useFakeTimers();
    localStorage.setItem('button_state', 'logout');
    fetchMock.mockResolvedValue({ status: 503 }); vi.stubGlobal('fetch', fetchMock);
    const mod = await loadModule(); mod.setSSEActiveDataset('backoff_orders');
    let connections = 1;
    for (const delay of [1000, 2000, 4000, 8000, 15000, 15000]) {
        globalThis.EventSource.mock.instances.at(-1).onerror();
        await vi.advanceTimersByTimeAsync(delay - 1);
        expect(globalThis.EventSource).toHaveBeenCalledTimes(connections);
        await vi.advanceTimersByTimeAsync(1);
        expect(globalThis.EventSource).toHaveBeenCalledTimes(++connections);
    }
});

test('a late denied probe cannot stop the replacement dataset stream', async () => {
    vi.useFakeTimers(); localStorage.setItem('button_state', 'logout');
    let finish;
    fetchMock.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    fetchMock.mockResolvedValue({ status: 503 }); vi.stubGlobal('fetch', fetchMock);
    const mod = await loadModule(); mod.setSSEActiveDataset('first_orders');
    const first = globalThis.EventSource.mock.instances.at(-1); first.onerror();
    mod.setSSEActiveDataset('replacement_orders');
    finish({ status: 403 }); await vi.advanceTimersByTimeAsync(0);
    expect(globalThis.EventSource).toHaveBeenCalledTimes(2);
    globalThis.EventSource.mock.instances.at(-1).onerror();
    await vi.advanceTimersByTimeAsync(1000);
    expect(globalThis.EventSource).toHaveBeenCalledTimes(3);
});

test('sign-out remains unsubscribed and a later verified sign-in resumes', async () => {
    vi.useFakeTimers(); localStorage.setItem('button_state', 'logout');
    fetchMock.mockResolvedValue({ status: 403 }); vi.stubGlobal('fetch', fetchMock);
    const mod = await loadModule(); mod.setSSEActiveDataset('auth_orders');
    globalThis.EventSource.mock.instances.at(-1).onerror(); await vi.advanceTimersByTimeAsync(0);
    localStorage.setItem('button_state', 'login'); sessionListeners.at(-1)('logout');
    window.dispatchEvent(new Event('routePermissionsRefreshed')); await vi.advanceTimersByTimeAsync(30000);
    expect(globalThis.EventSource).toHaveBeenCalledTimes(1);
    localStorage.setItem('button_state', 'logout'); sessionListeners.at(-1)('login');
    window.dispatchEvent(new Event('routePermissionsRefreshed'));
    expect(globalThis.EventSource).toHaveBeenCalledTimes(2);
});


test.each([false, true])('a verified rights refresh after backgrounding resumes on the visible page, refreshedWhileHidden=%s', async refreshedWhileHidden => {
    vi.useFakeTimers(); localStorage.setItem('button_state', 'logout');
    fetchMock.mockResolvedValue({ status: 403 }); vi.stubGlobal('fetch', fetchMock);
    const mod = await loadModule(); mod.setSSEActiveDataset('visible_orders');
    globalThis.EventSource.mock.instances.at(-1).onerror(); await vi.advanceTimersByTimeAsync(0);
    const previous = Object.getOwnPropertyDescriptor(document, 'visibilityState');
    const visibility = state => {
        Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
    };
    try {
        visibility('hidden');
        if (refreshedWhileHidden) window.dispatchEvent(new Event('routePermissionsRefreshed'));
        expect(globalThis.EventSource).toHaveBeenCalledTimes(1);
        visibility('visible');
        if (!refreshedWhileHidden) {
            expect(globalThis.EventSource).toHaveBeenCalledTimes(1);
            window.dispatchEvent(new Event('routePermissionsRefreshed'));
        }
        expect(globalThis.EventSource).toHaveBeenCalledTimes(2);
    } finally {
        if (previous) Object.defineProperty(document, 'visibilityState', previous);
        else delete document.visibilityState;
    }
});

});
