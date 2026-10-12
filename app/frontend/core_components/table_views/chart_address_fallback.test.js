// @vitest-environment jsdom
// chart_address_fallback.test.js
// Proves direct Chart addresses distinguish denied access from unsuitable data.
// Connects real startup selection, refresh, fallback rendering and address ownership.
// Keeps the explanation through the fallback projection's second data request.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ fetchData: vi.fn(), createView: vi.fn() }));
vi.mock('../endpoints/endpoint_router.js', () => ({
    endpoint_router: vi.fn(async () => ({ datasets: [{ dataset_name: 'chart_example' }], tab_order: [] })),
}));
vi.mock('../endpoints/endpoint_data_fetcher.js', () => ({ fetchDatasetData: mocks.fetchData }));
vi.mock('../navigation/database_tree/nav_builder.js', () => ({ create_navigation_buttons: vi.fn() }));
vi.mock('../navigation/admin_and_user_tools/custom_view_reader.js', () => ({
    custom_views: [], ensure_private_custom_views_loaded: vi.fn(async () => {}),
}));
vi.mock('../navigation/main_tabs/main_tab_printer.js', () => ({
    // The tab-opening boundary delegates to the real refresh, including its refetch.
    openNavTab: (dataset) => refreshTableUnified(dataset), updateTabPathsForView: vi.fn(),
}));
vi.mock('../dev_tools/function_counter.js', () => ({ count_this_function: vi.fn() }));
vi.mock('../front_page/front_page_navigation.js', () => ({ isSeparateFrontPageEnabled: () => false }));
vi.mock('../navigation/nav_engine/image_first_view_history.js', () => ({ isImageFirstViewURL: () => false }));
vi.mock('../navigation/nav_engine/card_article_return_state.js', () => ({
    getCardArticleReturnToken: () => null, invalidateCardArticleReturn: vi.fn(),
    shouldPreserveCardReturnHost: () => false,
}));
vi.mock('../route_permission_checker.js', async original => ({
    ...await original(), primeDatasetPermissions: vi.fn(async () => ({})),
}));
vi.mock('../config_fetcher.js', () => ({
    getDefaultViewSync: () => localStorage.getItem('test_site_default') || 'card',
    getDefaultDatasetSortSync: () => ({ column: 'id', direction: 'ASC' }),
}));
vi.mock('./dataset_view_renderer.js', () => ({ createDatasetViewElement: mocks.createView }));
vi.mock('./table_view/table_structure_builder.js', () => ({ saveColumnWidths: vi.fn() }));
vi.mock('../filterbar/filter_bar_builder.js', () => ({ create_filter_bar: () => document.createElement('div') }));
vi.mock('../filterbar/filter_list/active_filter_tag_printer.js', () => ({ renderActiveFilters: vi.fn() }));
vi.mock('../filterbar/filter_list/row_group_facet_printer.js', () => ({ renderRowGroupFacets: vi.fn() }));
vi.mock('../filterbar/filter_list/column_visibility_handler.js', () => ({ applyColumnVisibility: vi.fn() }));
vi.mock('../infinite_scroll/infinite_scroll_handler.js', () => ({
    initializeInfiniteScroll: vi.fn(), seedInfiniteScrollRowCount: vi.fn(), disconnectInfiniteScroll: vi.fn(),
    resetOffset: dataset => setUnifiedTableState(dataset, { offset: 0 }),
    updateOffset: (dataset, count) => setUnifiedTableState(dataset, { offset: count }),
}));
vi.mock('./map_view/map_view_printer.js', () => ({ dataset_supports_map_view: () => false }));
vi.mock('./card_view/row_article_opener.js', () => ({ openRowArticleView: vi.fn() }));

import { load_tables, resetEarlierVisitForgettingForTests } from '../admin_tools/main/table_loader_handler.js';
import { refreshTableUnified } from '../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js';
import { getChosenDatasetView, setChosenDatasetView } from '../state_stores/dataset_view_choice_saver.js';
import { getUnifiedTableState, setUnifiedTableState } from '../state_stores/table_state_store.js';
import { getParams, useUrlParams } from '../navigation/nav_engine/query_params.js';
import { clearDatasetAccessRegistry } from '../navigation/nav_engine/dataset_access_registry.js';
import { invalidateCache } from '../state_stores/table_specs_reader.js';
import { datasetAppearanceState } from './dataset_appearance_state.js';

beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    clearDatasetAccessRegistry();
    invalidateCache();
    datasetAppearanceState.clear();
    resetEarlierVisitForgettingForTests();
    document.body.innerHTML = '<div id="tabs_container"></div>';
    localStorage.setItem('chosen_language', 'en');
    history.replaceState({ __filterestEntryId: 'direct-chart', unrelated: 'keep' }, '',
        '/chart_example?view=price_chart&chart_x=observed_at&chart_y=id&sort_column=id&sort_order=ASC&status=open');
    mocks.createView.mockImplementation((definition, _dataset, _columns, rows) => {
        const element = document.createElement('div');
        element.dataset.testid = definition.viewKey === 'price_chart' ? 'price-chart-view' : 'fallback-rows';
        element.textContent = rows[0]?.name || 'Fitting chart';
        return element;
    });
    // Any unexpected external request fails the test; dataset answers are local fixtures.
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected network request'); }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

test.each([
    ['administrator grant, unsuitable dataset', true, false, null, 'card'],
    ['administrator grant, unsuitable dataset, table default', true, false, 'table', 'card'],
    ['administrator grant, unsuitable dataset Chart default', true, false, 'price_chart', 'card'],
    ['administrator grant, unsuitable site Chart default', true, false, null, 'price_chart'],
    ['reader without Chart, unsuitable dataset', false, false, null, 'card'],
    ['reader without Chart, fitting dataset', false, true, null, 'card'],
    ['denied dataset Chart default', false, true, 'price_chart', 'card'],
    ['denied site Chart default', false, true, null, 'price_chart'],
    ['administrator grant, fitting dataset', true, true, null, 'card'],
])('%s survives startup selection and projection refresh', async (_name, granted, fits, datasetDefault, siteDefault) => {
    localStorage.setItem('test_site_default', siteDefault);
    sessionStorage.setItem('user_permissions', JSON.stringify([
        '/ui/view/card', '/ui/view/table', ...(granted ? ['/ui/view/price_chart'] : []),
    ]));
    const noticesBeforeRefetch = [];
    mocks.fetchData.mockImplementation(async ({ view_key }) => {
        if (view_key !== 'price_chart') noticesBeforeRefetch.push(
            document.querySelectorAll('[data-testid="chart-unavailable"]').length);
        return {
            columns: fits ? ['id', 'observed_at'] : ['id', 'name'],
            types: fits ? { id: 'integer', observed_at: 'date' } : { id: 'integer', name: 'text' },
            data: [{ id: 1, name: view_key === 'price_chart' ? 'Chart projection' : 'Fallback projection', observed_at: '2026-01-01' }],
            row_count: 1, has_geo: false, table_meta: { default_view_name: datasetDefault },
        };
    });
    const push = vi.spyOn(history, 'pushState');
    const entryCount = history.length;
    await load_tables();

    const view = granted && fits ? 'price_chart' : datasetDefault === 'table' ? 'table' : 'card';
    const active = document.getElementById(`chart_example_${view}_view_container`);
    expect(active.style.display).toBe('block');
    expect(getChosenDatasetView('chart_example')).toBe(view);
    expect(mocks.fetchData.mock.calls.map(([request]) => request.view_key))
        .toEqual(view === 'price_chart' ? ['price_chart'] : ['price_chart', view]);
    expect(mocks.createView.mock.calls.map(([definition]) => definition.viewKey))
        .toEqual(view === 'price_chart' ? ['price_chart'] : [view, view]);
    expect(noticesBeforeRefetch).toEqual(view === 'price_chart' ? [] : [granted && !fits ? 1 : 0]);
    const notice = active.querySelector('[data-testid="chart-unavailable"]');
    if (granted && !fits) {
        expect(notice).not.toBeNull();
        expect(notice.textContent).toContain('Chart requires');
        expect([...notice.querySelectorAll('[data-view-key]')].map(button => button.dataset.viewKey))
            .toEqual(['card', 'table', 'product_card', 'calendar', 'map']);
        expect(active.querySelector('[data-testid="fallback-rows"]').textContent).toBe('Fallback projection');
    } else {
        expect(notice).toBeNull();
    }
    expect(document.querySelectorAll('[data-testid="price-chart-view"]')).toHaveLength(granted && fits ? 1 : 0);
    expect(new URLSearchParams(location.search).get('view')).toBe(view);
    expect(getParams('chart_example')).toMatchObject({ view, status: 'open', chart_x: 'observed_at', chart_y: 'id' });
    expect(getUnifiedTableState('chart_example')).toMatchObject({ filters: { status: 'open' }, sort: { column: 'id', direction: 'ASC' } });
    expect(history.length).toBe(entryCount);
    expect(push).not.toHaveBeenCalled();
    expect(history.state).toMatchObject({ __filterestEntryId: 'direct-chart', unrelated: 'keep' });
    expect(fetch).not.toHaveBeenCalled();
    push.mockRestore();

    if (granted && !fits) {
        // The request context belongs only to this fallback; choosing Table clears it.
        setChosenDatasetView('chart_example', 'table');
        useUrlParams();
        await refreshTableUnified('chart_example', { skipUrlParams: true });
        expect(document.querySelector('[data-testid="chart-unavailable"]')).toBeNull();
    }
});
