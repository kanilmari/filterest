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
const saveCellMock = vi.fn();

async function loadModule(useRealRefresh = false) {
    vi.resetModules();
    vi.doMock('../auth/session_generation_store.js', () => ({
        subscribeToSessionGeneration: listener => { sessionListeners.push(listener); return () => {}; },
    }));
    const refreshPath = '../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js';
    if (useRealRefresh) vi.doUnmock(refreshPath);
    else vi.doMock(refreshPath, () => ({ refreshTableUnified: refreshTableUnifiedMock }));
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

        expect(rerenderCachedSearchResultsMock).toHaveBeenCalledWith('app_service_catalog', null, {
            isCurrent: expect.any(Function), beforeSwap: expect.any(Function),
        });
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

        expect(doIntelligentSearchMock).toHaveBeenCalledWith('app_service_catalog', 'service catalog', {}, {
            isCurrent: expect.any(Function), beforeSwap: expect.any(Function),
        });
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


async function openTrackedEditor(tableName = 'orders') {
    const state = await import('../general_tables/gt_1_row_crud/gt_1_3_row_update/inline_editor_state.js');
    const cell = document.createElement('div'); cell.className = 'editing'; document.body.append(cell);
    const editor = state.beginInlineEditor(cell, tableName, () => { cell.classList.remove('editing'); });
    editor.ready();
    return { state, cell, editor };
}

function emitRowChange(table = 'orders') {
    eventSourceAddEventListenerMock.mock.calls.findLast(([event]) => event === 'row_change')[1]({
        data: JSON.stringify({ table }),
    });
}

test('a viewer without an editor starts at main’s 180 and 380 ms even when the first answer is at 500 ms', async () => {
    vi.useFakeTimers(); vi.setSystemTime(0); localStorage.setItem('button_state', 'logout');
    getParamsMock.mockReturnValue({}); datasetSearchGetMock.mockReturnValue('');
    const starts = []; let firstAnswer;
    refreshTableUnifiedMock.mockReset().mockImplementationOnce(() => {
        starts.push(Date.now()); return new Promise(resolve => { firstAnswer = resolve; });
    }).mockImplementation(async () => { starts.push(Date.now()); });
    const mod = await loadModule(); mod.setSSEActiveDataset('orders'); emitRowChange();
    await vi.advanceTimersByTimeAsync(180); expect(starts).toEqual([180]);
    await vi.advanceTimersByTimeAsync(20); emitRowChange();
    await vi.advanceTimersByTimeAsync(180); expect(starts).toEqual([180, 380]);
    await vi.advanceTimersByTimeAsync(120); firstAnswer();
    await vi.advanceTimersByTimeAsync(1); expect(starts).toEqual([180, 380]);
});

test('an answer before the next viewer debounce does not start that refresh early', async () => {
    vi.useFakeTimers(); vi.setSystemTime(0); localStorage.setItem('button_state', 'logout');
    getParamsMock.mockReturnValue({}); datasetSearchGetMock.mockReturnValue('');
    const starts = []; let firstAnswer;
    refreshTableUnifiedMock.mockReset().mockImplementationOnce(() => {
        starts.push(Date.now()); return new Promise(resolve => { firstAnswer = resolve; });
    }).mockImplementation(async () => { starts.push(Date.now()); });
    const mod = await loadModule(); mod.setSSEActiveDataset('orders'); emitRowChange();
    await vi.advanceTimersByTimeAsync(200); emitRowChange();
    await vi.advanceTimersByTimeAsync(50); firstAnswer();
    await vi.advanceTimersByTimeAsync(129); expect(starts).toEqual([180]);
    await vi.advanceTimersByTimeAsync(1); expect(starts).toEqual([180, 380]);
});

test('three changes during one edit cause one refresh after close, with no hold timeout', async () => {
    vi.useFakeTimers(); localStorage.setItem('button_state', 'logout');
    refreshTableUnifiedMock.mockReset().mockResolvedValue({});
    getParamsMock.mockReturnValue({}); datasetSearchGetMock.mockReturnValue('');
    const mod = await loadModule(); mod.setSSEActiveDataset('orders');
    const { cell, state } = await openTrackedEditor();
    emitRowChange(); emitRowChange(); emitRowChange();
    await vi.advanceTimersByTimeAsync(3600000);
    expect(refreshTableUnifiedMock).not.toHaveBeenCalled();
    expect(state.hasHeldInlineChange('orders')).toBe(true);
    cell.classList.remove('editing'); await vi.advanceTimersByTimeAsync(1);
    expect(refreshTableUnifiedMock).toHaveBeenCalledTimes(1);
    expect(state.hasHeldInlineChange('orders')).toBe(false);
    cell.remove();
});

test.each(['listing', 'committed search', 'cached search'])('an in-flight %s answer yields to an editor and reruns once on close', async route => {
    vi.useFakeTimers(); localStorage.setItem('button_state', 'logout');
    getParamsMock.mockReturnValue(route === 'committed search' ? { search: 'question' } : {});
    datasetSearchGetMock.mockReturnValue(route === 'cached search' ? 'question' : '');
    hasCachedSearchResultsMock.mockReturnValue(route === 'cached search');
    const refresh = route === 'listing' ? refreshTableUnifiedMock
        : route === 'committed search' ? doIntelligentSearchMock : rerenderCachedSearchResultsMock;
    let answer; const render = vi.fn();
    refresh.mockReset().mockImplementationOnce((...args) => new Promise(resolve => {
        const options = args.at(-1);
        answer = () => { if (options.isCurrent()) render(); resolve(); };
    })).mockResolvedValue({});
    const mod = await loadModule(); mod.setSSEActiveDataset('orders'); emitRowChange();
    await vi.advanceTimersByTimeAsync(180);
    const { cell } = await openTrackedEditor(); answer(); await vi.advanceTimersByTimeAsync(1);
    expect(render).not.toHaveBeenCalled(); expect(refresh).toHaveBeenCalledTimes(1);
    cell.classList.remove('editing'); await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(2);
    cell.remove();
});

test.each(['session', 'rights', 'navigation'])('%s drops a held refresh and discards its editor', async reason => {
    vi.useFakeTimers(); localStorage.setItem('button_state', 'logout');
    refreshTableUnifiedMock.mockReset().mockResolvedValue({}); getParamsMock.mockReturnValue({});
    datasetSearchGetMock.mockReturnValue('');
    const mod = await loadModule(); mod.setSSEActiveDataset('orders');
    const { state, cell, editor } = await openTrackedEditor(); emitRowChange();
    try {
        if (reason === 'session') eventSourceAddEventListenerMock.mock.calls.findLast(([event]) => event === 'session_ended')[1]();
        else if (reason === 'rights') sessionListeners.at(-1)('session-invalidated');
        else { editor.discard(); mod.clearSSEActiveDataset(); }
        await vi.advanceTimersByTimeAsync(1000);
        expect(refreshTableUnifiedMock).not.toHaveBeenCalled();
        expect(state.hasHeldInlineChange('orders')).toBe(false);
        expect(editor.discarded).toBe(true);
    } finally {
        cell.remove();
    }
});

async function openDraftEditor(tableName = 'orders', multilingual = false, value = multilingual ? { en: 'Original' } : 'Original') {
    saveCellMock.mockReset().mockResolvedValue({});
    vi.doMock('./endpoint_router.js', () => ({ endpoint_router: saveCellMock }));
    const { editCell } = await import('../general_tables/gt_1_row_crud/gt_1_3_row_update/cell_editor.js');
    const state = await import('../general_tables/gt_1_row_crud/gt_1_3_row_update/inline_editor_state.js');
    const root = document.createElement('div'); root.id = `${tableName}_container`;
    const table = document.createElement('table'); root.append(table); document.body.append(root);
    const cell = table.createTBody().insertRow().insertCell();
    Object.assign(cell.dataset, { rowIndex: '0', colIndex: '1', column: 'title' });
    cell.textContent = value == null ? '' : 'Original';
    await editCell(cell, ['id', 'title'], [{ id: 7, title: value }],
        { title: { data_type: 'text', is_multilingual: multilingual } }, tableName);
    const input = cell.querySelector('input, textarea'); input.value = 'Typed draft';
    return { state, root, cell, input };
}

test('a field missing from the correct List read keeps the draft on retries; Escape releases the hold', async () => {
    vi.useFakeTimers(); localStorage.setItem('button_state', 'logout');
    getParamsMock.mockReturnValue({}); datasetSearchGetMock.mockReturnValue('');
    refreshTableUnifiedMock.mockReset().mockResolvedValue({});
    const mod = await loadModule(); mod.setSSEActiveDataset('orders');
    const views = await import('../state_stores/dataset_view_choice_saver.js');
    views.setChosenDatasetView('orders', 'normal');
    const { state, root, cell, input } = await openDraftEditor('orders', true); emitRowChange();
    saveCellMock.mockResolvedValue({ data: [{ id: 7 }] });
    try {
        for (let attempt = 1; attempt <= 2; attempt++) {
            input.focus(); input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
            await vi.advanceTimersByTimeAsync(1);
            expect(saveCellMock).toHaveBeenCalledTimes(attempt);
            expect(saveCellMock.mock.calls.at(-1)).toEqual(['getResults', { url_params: '?dataset=orders&id=7&view_key=normal' }]);
            expect(cell.dataset.inlineSaveState).toBe('retry'); expect(input.value).toBe('Typed draft');
            expect(state.hasHeldInlineChange('orders')).toBe(true);
            expect(refreshTableUnifiedMock).not.toHaveBeenCalled();
        }
        input.focus(); input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        await vi.advanceTimersByTimeAsync(1);
        expect(saveCellMock).toHaveBeenCalledTimes(2);
        expect(state.hasOpenInlineEditor('orders')).toBe(false); expect(state.hasHeldInlineChange('orders')).toBe(false);
        expect(refreshTableUnifiedMock).toHaveBeenCalledTimes(1);
    } finally { state.discardInlineEditors(root); root.remove(); views.forgetChosenDatasetView('orders'); }
});

function changeVisibility(visibility) {
    Object.defineProperty(document, 'visibilityState', { value: visibility, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
}

test.each([false, true])('a hidden page keeps its draft and rebuilds once on close, closedWhileHidden=%s', async closedWhileHidden => {
    vi.useFakeTimers(); localStorage.setItem('button_state', 'logout');
    refreshTableUnifiedMock.mockReset().mockResolvedValue({});
    getParamsMock.mockReturnValue({}); datasetSearchGetMock.mockReturnValue('');
    const previous = Object.getOwnPropertyDescriptor(document, 'visibilityState');
    const mod = await loadModule(); mod.setSSEActiveDataset('orders');
    const { state, root, cell, input } = await openDraftEditor(); emitRowChange();
    try {
        changeVisibility('hidden'); await vi.advanceTimersByTimeAsync(1000);
        if (!closedWhileHidden) { changeVisibility('visible'); await vi.advanceTimersByTimeAsync(1000); }
        expect(cell.querySelector('input, textarea')).toBe(input);
        expect(input.value).toBe('Typed draft'); expect(state.hasOpenInlineEditor('orders')).toBe(true);
        expect(state.hasHeldInlineChange('orders')).toBe(true);
        expect(saveCellMock).not.toHaveBeenCalled(); expect(refreshTableUnifiedMock).not.toHaveBeenCalled();
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        await vi.advanceTimersByTimeAsync(1000);
        expect(state.hasOpenInlineEditor('orders')).toBe(false);
        expect(state.hasHeldInlineChange('orders')).toBe(false);
        expect(saveCellMock).not.toHaveBeenCalled(); expect(refreshTableUnifiedMock).toHaveBeenCalledTimes(1);
        if (closedWhileHidden) { changeVisibility('visible'); await vi.advanceTimersByTimeAsync(1000); }
        expect(refreshTableUnifiedMock).toHaveBeenCalledTimes(1);
    } finally {
        state.discardInlineEditors(root); root.remove();
        if (previous) Object.defineProperty(document, 'visibilityState', previous); else delete document.visibilityState;
    }
});

test.each(['beforeunload', 'pagehide'])('%s leaves the editor and held change untouched', async eventName => {
    vi.useFakeTimers(); localStorage.setItem('button_state', 'logout');
    refreshTableUnifiedMock.mockReset().mockResolvedValue({});
    getParamsMock.mockReturnValue({}); datasetSearchGetMock.mockReturnValue('');
    const mod = await loadModule(); mod.setSSEActiveDataset('orders');
    const { state, root, cell, input } = await openDraftEditor(); emitRowChange();
    try {
        const event = new Event(eventName, { cancelable: true });
        if (eventName === 'beforeunload') event.preventDefault();
        window.dispatchEvent(event); await vi.advanceTimersByTimeAsync(1000);
        expect(cell.querySelector('input, textarea')).toBe(input); expect(input.value).toBe('Typed draft');
        expect(state.hasOpenInlineEditor('orders')).toBe(true); expect(state.hasHeldInlineChange('orders')).toBe(true);
        expect(saveCellMock).not.toHaveBeenCalled(); expect(refreshTableUnifiedMock).not.toHaveBeenCalled();
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); await vi.advanceTimersByTimeAsync(1000);
        expect(saveCellMock).not.toHaveBeenCalled(); expect(refreshTableUnifiedMock).toHaveBeenCalledTimes(1);
    } finally { state.discardInlineEditors(root); root.remove(); }
});

test('a row change delivered while the document is hidden is retained until the editor closes', async () => {
    vi.useFakeTimers(); localStorage.setItem('button_state', 'logout');
    refreshTableUnifiedMock.mockReset().mockResolvedValue({});
    getParamsMock.mockReturnValue({}); datasetSearchGetMock.mockReturnValue('');
    const previous = Object.getOwnPropertyDescriptor(document, 'visibilityState');
    const mod = await loadModule(); mod.setSSEActiveDataset('orders');
    const { state, root, input } = await openDraftEditor();
    try {
        // The document can be hidden before its queued visibilitychange pauses transport.
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
        emitRowChange(); document.dispatchEvent(new Event('visibilitychange'));
        await vi.advanceTimersByTimeAsync(1000);
        expect(state.hasHeldInlineChange('orders')).toBe(true); expect(refreshTableUnifiedMock).not.toHaveBeenCalled();
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); await vi.advanceTimersByTimeAsync(1000);
        expect(saveCellMock).not.toHaveBeenCalled(); expect(refreshTableUnifiedMock).toHaveBeenCalledTimes(1);
    } finally {
        state.discardInlineEditors(root); root.remove();
        if (previous) Object.defineProperty(document, 'visibilityState', previous); else delete document.visibilityState;
    }
});

test.each(['no subscribed tables', 'no authenticated session'])('connecting with %s preserves another container editor', async reason => {
    vi.useFakeTimers(); localStorage.setItem('button_state', 'logout');
    const mod = await loadModule(); mod.setSSEActiveDataset('orders');
    const { state, root, cell, input } = await openDraftEditor('other_orders');
    try {
        if (reason === 'no authenticated session') {
            localStorage.setItem('button_state', 'login'); mod.setSSEActiveDataset('next_orders');
        } else mod.clearSSEActiveDataset();
        await vi.advanceTimersByTimeAsync(1000);
        expect(state.hasOpenInlineEditor('other_orders')).toBe(true);
        expect(cell.querySelector('input, textarea')).toBe(input); expect(input.value).toBe('Typed draft');
        expect(saveCellMock).not.toHaveBeenCalled();
    } finally { state.discardInlineEditors(root); root.remove(); }
});

test.each([401, 403])('HTTP %s drops a held refresh and discards its editor without saving', async status => {
    vi.useFakeTimers(); localStorage.setItem('button_state', 'logout');
    refreshTableUnifiedMock.mockReset().mockResolvedValue({});
    fetchMock.mockResolvedValue({ status }); vi.stubGlobal('fetch', fetchMock);
    const mod = await loadModule(); mod.setSSEActiveDataset('orders');
    const { state, root, cell, input } = await openDraftEditor(); emitRowChange();
    try {
        globalThis.EventSource.mock.instances.at(-1).onerror(); await vi.advanceTimersByTimeAsync(1000);
        input.dispatchEvent(new Event('blur'));
        expect(cell.textContent).toBe('Original'); expect(state.hasOpenInlineEditor('orders')).toBe(false);
        expect(state.hasHeldInlineChange('orders')).toBe(false);
        expect(saveCellMock).not.toHaveBeenCalled(); expect(refreshTableUnifiedMock).not.toHaveBeenCalled();
    } finally { state.discardInlineEditors(root); root.remove(); }
});


test('a completed refresh guard cannot strand a new hold when a later editor opens', async () => {
    vi.useFakeTimers(); localStorage.setItem('button_state', 'logout');
    getParamsMock.mockReturnValue({}); datasetSearchGetMock.mockReturnValue('');
    refreshTableUnifiedMock.mockReset().mockResolvedValue({});
    const mod = await loadModule(); mod.setSSEActiveDataset('orders'); emitRowChange();
    await vi.advanceTimersByTimeAsync(180);
    const guard = refreshTableUnifiedMock.mock.calls[0][1].isCurrent;
    const { cell, state } = await openTrackedEditor();
    expect(guard()).toBe(true); expect(state.hasHeldInlineChange('orders')).toBe(false);
    cell.classList.remove('editing'); await vi.advanceTimersByTimeAsync(1);
    expect(refreshTableUnifiedMock).toHaveBeenCalledTimes(1); cell.remove();
});

test('an editor that closes before the delayed answer still causes one fresh rebuild', async () => {
    vi.useFakeTimers(); localStorage.setItem('button_state', 'logout');
    getParamsMock.mockReturnValue({}); datasetSearchGetMock.mockReturnValue('');
    let answer;
    refreshTableUnifiedMock.mockReset().mockImplementationOnce((_table, options) => new Promise(resolve => {
        answer = () => { expect(options.isCurrent()).toBe(false); resolve(); };
    })).mockResolvedValue({});
    const mod = await loadModule(); mod.setSSEActiveDataset('orders'); emitRowChange();
    await vi.advanceTimersByTimeAsync(180);
    const { cell } = await openTrackedEditor(); cell.classList.remove('editing');
    await vi.advanceTimersByTimeAsync(1); answer(); await vi.advanceTimersByTimeAsync(1);
    expect(refreshTableUnifiedMock).toHaveBeenCalledTimes(2); cell.remove();
});

test.each([false, true])('the real unified refresh preserves the hold and rebuilds after close, olderAnswerFirst=%s', async olderAnswerFirst => {
    vi.useFakeTimers(); localStorage.setItem('button_state', 'logout');
    getParamsMock.mockReturnValue({}); datasetSearchGetMock.mockReturnValue('');
    const result = { columns: ['id', 'title'], data: [{ id: 7, title: 'Current' }], types: {}, row_count: 1 };
    let answer, newerAnswer;
    const fetchRows = vi.fn().mockImplementationOnce(() => new Promise(resolve => { answer = resolve; }));
    if (olderAnswerFirst) fetchRows.mockImplementationOnce(() => new Promise(resolve => { newerAnswer = resolve; }));
    fetchRows.mockResolvedValue(result);
    const render = vi.fn().mockResolvedValue(document.createElement('div'));
    const disconnect = vi.fn(), reset = vi.fn(), advance = vi.fn();
    let state = { offset: 0, sort: { column: 'id', direction: 'ASC' }, filters: {} };
    vi.doMock('./endpoint_data_fetcher.js', () => ({ fetchDatasetData: fetchRows }));
    vi.doMock('../table_views/dataset_view_printer.js', () => ({ generate_table: render }));
    vi.doMock('../infinite_scroll/infinite_scroll_handler.js', () => ({
        disconnectInfiniteScroll: disconnect, resetOffset: reset, updateOffset: advance,
    }));
    vi.doMock('../state_stores/table_state_store.js', () => ({
        getUnifiedTableState: () => state, setUnifiedTableState: (_table, patch) => { state = { ...state, ...patch }; },
    }));
    vi.doMock('../route_permission_checker.js', () => ({ primeDatasetPermissions: vi.fn() }));
    vi.doMock('../table_views/card_view/row_article_opener.js', () => ({ openRowArticleView: vi.fn() }));
    vi.doMock('../filterbar/filter_list/column_visibility_handler.js', () => ({ applyColumnVisibility: vi.fn() }));
    vi.doMock('../navigation/nav_engine/dataset_address_writer.js', () => ({ updateDatasetAddress: vi.fn() }));
    const mod = await loadModule(true); mod.setSSEActiveDataset('orders'); emitRowChange();
    await vi.advanceTimersByTimeAsync(180); expect(fetchRows).toHaveBeenCalledTimes(1);
    if (olderAnswerFirst) {
        await vi.advanceTimersByTimeAsync(20); emitRowChange();
        await vi.advanceTimersByTimeAsync(180); expect(fetchRows).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(20); // Both listings are out when the empty cell opens at 400 ms.
        localStorage.setItem('chosen_language', 'en');
        const { state, root, input } = await openDraftEditor('orders', true, null);
        input.value = 'English';
        saveCellMock.mockResolvedValueOnce({ data: [{ id: 7, title: { fi: 'Suomi' } }] });
        try {
            await vi.advanceTimersByTimeAsync(100); answer(result); await vi.advanceTimersByTimeAsync(0);
            // The older generation skips the editor guard; the outstanding run must still protect confirmation.
            expect(render).not.toHaveBeenCalled(); expect(state.hasOpenInlineEditor('orders')).toBe(true);
            expect(state.hasHeldInlineChange('orders')).toBe(true);
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); await vi.advanceTimersByTimeAsync(0);
            expect(saveCellMock).toHaveBeenCalledTimes(2);
            expect(saveCellMock.mock.calls[0]).toEqual(['getResults', { url_params: '?dataset=orders&id=7&view_key=table' }]);
            expect(JSON.parse(saveCellMock.mock.calls[1][1].body_data.value)).toEqual({ fi: 'Suomi', en: 'English' });
            expect(fetchRows).toHaveBeenCalledTimes(2);
            newerAnswer(result); await vi.advanceTimersByTimeAsync(1);
            expect(fetchRows).toHaveBeenCalledTimes(3); expect(render).toHaveBeenCalledTimes(1);
            expect(state.hasHeldInlineChange('orders')).toBe(false);
        } finally { state.discardInlineEditors(root); root.remove(); }
        return;
    }
    const { cell } = await openTrackedEditor(); answer(result); await vi.advanceTimersByTimeAsync(1);
    expect(render).not.toHaveBeenCalled(); expect(disconnect).toHaveBeenCalledTimes(1); expect(reset).toHaveBeenCalledTimes(1);
    cell.classList.remove('editing'); await vi.advanceTimersByTimeAsync(1);
    expect(fetchRows).toHaveBeenCalledTimes(2); expect(render).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(2); expect(reset).toHaveBeenCalledTimes(2); expect(advance).toHaveBeenCalledTimes(1);
    expect(render.mock.calls[0][9].isCurrent()).toBe(true); cell.remove();
});
});
