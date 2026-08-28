// @vitest-environment jsdom
// sse_subscriber.test.js
// Verifies shared SSE subscribe behavior for guest and authenticated browsing modes.
// Bridges local auth-state cache, EventSource setup, and the centralized subscriber module.
// Exists to stop guest/public browsing from reopening a forbidden SSE stream on every navigation.

import { beforeEach, describe, expect, test, vi } from 'vitest';

const refreshTableUnifiedMock = vi.fn();
const getParamsMock = vi.fn();
const doIntelligentSearchMock = vi.fn();
const hasCachedSearchResultsMock = vi.fn();
const rerenderCachedSearchResultsMock = vi.fn();
const datasetSearchGetMock = vi.fn();
const eventSourceAddEventListenerMock = vi.fn();
const eventSourceCloseMock = vi.fn();

async function loadModule() {
    vi.resetModules();
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
    return import('./sse_subscriber.js');
}

describe('sse_subscriber', () => {
    beforeEach(() => {
        localStorage.clear();
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
