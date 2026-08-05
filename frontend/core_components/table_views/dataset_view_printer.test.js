// @vitest-environment jsdom
// dataset_view_printer.test.js
// Verifies dataset view assembly ordering for the shared filterbar and active view.
// Bridges mocked view builders and the real generate_table orchestration in jsdom.
// Exists to keep filterbar rendering from regressing behind slow async view builders.

import { beforeEach, describe, expect, test, vi } from 'vitest';

const createTableElementMock = vi.fn(() => document.createElement('div'));
const saveColumnWidthsMock = vi.fn();
const createCardViewMock = vi.fn();
const initializeInfiniteScrollMock = vi.fn();
const seedInfiniteScrollRowCountMock = vi.fn();
const createFilterBarMock = vi.fn();
const setResultsCountMock = vi.fn();
const renderActiveFiltersMock = vi.fn();
const createTreeViewMock = vi.fn(async () => document.createElement('div'));
const applyViewStylingMock = vi.fn();
const hasRoutePermissionMock = vi.fn(() => true);
const getDefaultViewSyncMock = vi.fn(() => 'card');
const createSettingsViewMock = vi.fn(() => document.createElement('div'));
const createProductCardViewMock = vi.fn(() => document.createElement('div'));
const createCalendarViewMock = vi.fn(() => document.createElement('div'));
const createMapViewMock = vi.fn(() => document.createElement('div'));
const createPriceChartViewMock = vi.fn(() => document.createElement('div'));
const createCloudManagementViewMock = vi.fn(() => document.createElement('div'));
const datasetSupportsMapViewMock = vi.fn(() => true);
const getAllSpecsMock = vi.fn(() => ({}));

vi.mock('./table_view/table_structure_builder.js', () => ({
    create_table_element: createTableElementMock,
    saveColumnWidths: saveColumnWidthsMock,
}));

vi.mock('./card_view/card_view_printer.js', () => ({
    create_card_view: createCardViewMock,
}));

vi.mock('../infinite_scroll/infinite_scroll_handler.js', () => ({
    initializeInfiniteScroll: initializeInfiniteScrollMock,
    seedInfiniteScrollRowCount: seedInfiniteScrollRowCountMock,
}));

vi.mock('../filterbar/filter_bar_builder.js', () => ({
    create_filter_bar: createFilterBarMock,
}));

vi.mock('../../reusable_components/results_count/results_count_printer.js', () => ({
    setResultsCount: setResultsCountMock,
}));

vi.mock('../filterbar/filter_list/active_filter_tag_printer.js', () => ({
    renderActiveFilters: renderActiveFiltersMock,
}));

vi.mock('./tree_view/tree_view_printer.js', () => ({
    create_tree_view: createTreeViewMock,
}));

vi.mock('./table_component_builder.js', () => ({
    TableComponent: class {
        getElement() {
            return document.createElement('div');
        }
    },
}));

vi.mock('./view_selector_printer.js', () => ({
    applyViewStyling: applyViewStylingMock,
}));

vi.mock('./settings_view/settings_view_printer.js', () => ({
    create_settings_view: createSettingsViewMock,
}));

vi.mock('./product_card_view/product_card_view_printer.js', () => ({
    create_product_card_view: createProductCardViewMock,
}));

vi.mock('./calendar_view/calendar_view_printer.js', () => ({
    create_calendar_view: createCalendarViewMock,
}));

vi.mock('./map_view/map_view_printer.js', () => ({
    create_map_view: createMapViewMock,
    dataset_supports_map_view: datasetSupportsMapViewMock,
}));

vi.mock('./price_chart_view/price_chart_view_printer.js', () => ({
    create_price_chart_view: createPriceChartViewMock,
}));

vi.mock('./cloud_management_view/cloud_management_view_printer.js', () => ({
    create_cloud_management_view: createCloudManagementViewMock,
}));

vi.mock('../route_permission_checker.js', () => ({
    hasRoutePermission: hasRoutePermissionMock,
}));

vi.mock('../config_fetcher.js', () => ({
    getDefaultViewSync: getDefaultViewSyncMock,
}));

vi.mock('../../ui_config.js', () => ({
    show_search_and_filter_button: false,
}));

vi.mock('../state_stores/table_specs_reader.js', () => ({
    getAllSpecs: getAllSpecsMock,
}));

describe('generate_table', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        document.body.innerHTML = '<div id="tabs_container"></div>';
        localStorage.clear();
        createCardViewMock.mockImplementation(() => document.createElement('div'));
        createMapViewMock.mockImplementation(() => document.createElement('div'));
        createPriceChartViewMock.mockImplementation(() => document.createElement('div'));
        createCloudManagementViewMock.mockImplementation(() => document.createElement('div'));
        datasetSupportsMapViewMock.mockReturnValue(true);
    });

    test('starts building the filterbar before an async card view finishes', async () => {
        const events = [];
        let resolveCardView;

        createCardViewMock.mockImplementationOnce(() => {
            events.push('view-start');
            return new Promise((resolve) => {
                resolveCardView = () => {
                    events.push('view-resolve');
                    const cardElement = document.createElement('div');
                    cardElement.className = 'card-view';
                    resolve(cardElement);
                };
            });
        });
        createFilterBarMock.mockImplementationOnce(() => {
            events.push('filterbar');
            return document.createElement('div');
        });

        localStorage.setItem('demo_dataset_view', 'card');

        const { generate_table } = await import('./dataset_view_printer.js');
        const renderPromise = generate_table(
            'demo_dataset',
            ['id'],
            [{ id: 1 }],
            { id: 'INTEGER' },
            1,
            false,
            null
        );

        await Promise.resolve();

        expect(events).toEqual(['view-start', 'filterbar']);
        expect(createFilterBarMock).toHaveBeenCalledTimes(1);

        resolveCardView();
        await renderPromise;

        expect(events).toEqual(['view-start', 'filterbar', 'view-resolve']);
        expect(seedInfiniteScrollRowCountMock).toHaveBeenCalledWith('demo_dataset', 1);
        expect(initializeInfiniteScrollMock).toHaveBeenCalledWith('demo_dataset', 'vertical');
    });

    test('falls back from map view when the dataset has no map-capable fields', async () => {
        datasetSupportsMapViewMock.mockReturnValueOnce(false);
        localStorage.setItem('demo_dataset_view', 'map');

        const { generate_table } = await import('./dataset_view_printer.js');
        const activeContainer = await generate_table(
            'demo_dataset',
            ['id', 'title'],
            [{ id: 1, title: 'Brave' }],
            { id: 'INTEGER', title: 'TEXT' },
            1,
            false,
            null
        );

        expect(createMapViewMock).not.toHaveBeenCalled();
        expect(createCardViewMock).toHaveBeenCalledWith(
            ['id', 'title'],
            [{ id: 1, title: 'Brave' }],
            'demo_dataset'
        );
        expect(localStorage.getItem('demo_dataset_view')).toBe('card');
        expect(activeContainer.id).toBe('demo_dataset_card_view_container');
    });

    test('keeps map view when the dataset has geospatial support', async () => {
        datasetSupportsMapViewMock.mockReturnValueOnce(true);
        localStorage.setItem('demo_dataset_view', 'map');

        const { generate_table } = await import('./dataset_view_printer.js');
        const activeContainer = await generate_table(
            'demo_dataset',
            ['id', 'position'],
            [{ id: 1, position: 'POINT(24.9 60.1)' }],
            { id: 'INTEGER', position: { data_type: 'geometry' } },
            1,
            true,
            null
        );

        expect(createMapViewMock).toHaveBeenCalledWith(
            'demo_dataset',
            ['id', 'position'],
            [{ id: 1, position: 'POINT(24.9 60.1)' }],
            { id: 'INTEGER', position: { data_type: 'geometry' } }
        );
        expect(createCardViewMock).not.toHaveBeenCalled();
        expect(localStorage.getItem('demo_dataset_view')).toBe('map');
        expect(activeContainer.id).toBe('demo_dataset_map_view_container');
    });

    test('passes multilingual column metadata to the tree view', async () => {
        localStorage.setItem('demo_dataset_view', 'tree');
        const rows = [{ id: 1, name: '{"en":"English","fi":"Suomi"}' }];
        const dataTypes = {
            id: { data_type: 'integer' },
            name: { data_type: 'text', is_multilingual: true },
        };

        const { generate_table } = await import('./dataset_view_printer.js');
        await generate_table(
            'demo_dataset',
            ['id', 'name'],
            rows,
            dataTypes,
            1,
            false,
            null
        );

        expect(createTreeViewMock).toHaveBeenCalledWith(
            'demo_dataset',
            ['id', 'name'],
            rows,
            dataTypes
        );
    });

    test('renders price chart view when selected', async () => {
        localStorage.setItem('demo_dataset_view', 'price_chart');

        const { generate_table } = await import('./dataset_view_printer.js');
        const activeContainer = await generate_table(
            'demo_dataset',
            ['observed_at', 'close_price'],
            [{ observed_at: '2026-01-01', close_price: 100 }],
            { observed_at: 'DATE', close_price: 'NUMERIC' },
            1,
            false,
            null
        );

        expect(createPriceChartViewMock).toHaveBeenCalledWith(
            'demo_dataset',
            ['observed_at', 'close_price'],
            [{ observed_at: '2026-01-01', close_price: 100 }],
            { observed_at: 'DATE', close_price: 'NUMERIC' }
        );
        expect(activeContainer.id).toBe('demo_dataset_price_chart_view_container');
    });

    test('normalizes selector aliases to renderable view keys', async () => {
        localStorage.setItem('demo_dataset_view', 'article');

        const { generate_table } = await import('./dataset_view_printer.js');
        const activeContainer = await generate_table(
            'demo_dataset',
            ['id', 'title'],
            [{ id: 1, title: 'Brave' }],
            { id: 'INTEGER', title: 'TEXT' },
            1,
            false,
            null
        );

        expect(createCardViewMock).toHaveBeenCalledWith(
            ['id', 'title'],
            [{ id: 1, title: 'Brave' }],
            'demo_dataset'
        );
        expect(localStorage.getItem('demo_dataset_view')).toBe('card');
        expect(activeContainer.id).toBe('demo_dataset_card_view_container');
    });

    test('falls back from stale non-renderable view keys', async () => {
        localStorage.setItem('demo_dataset_view', 'legacy_magic_view');

        const { generate_table } = await import('./dataset_view_printer.js');
        const activeContainer = await generate_table(
            'demo_dataset',
            ['id', 'title'],
            [{ id: 1, title: 'Brave' }],
            { id: 'INTEGER', title: 'TEXT' },
            1,
            false,
            null
        );

        expect(createCardViewMock).toHaveBeenCalledWith(
            ['id', 'title'],
            [{ id: 1, title: 'Brave' }],
            'demo_dataset'
        );
        expect(localStorage.getItem('demo_dataset_view')).toBe('card');
        expect(activeContainer.id).toBe('demo_dataset_card_view_container');
    });

    test('migrates cloud-management datasets from stale generic views to their DB default once', async () => {
        localStorage.setItem('app_cloud_services_view', 'card');
        getAllSpecsMock.mockReturnValueOnce({
            app_cloud_services: {
                table_uid: 3148,
                default_view_name: 'cloud_management',
            },
        });

        const { generate_table } = await import('./dataset_view_printer.js');
        const activeContainer = await generate_table(
            'app_cloud_services',
            ['id', 'service_key'],
            [{ id: 1, service_key: 'easelect_com' }],
            { id: 'INTEGER', service_key: 'TEXT' },
            1,
            false,
            null
        );

        expect(createCloudManagementViewMock).toHaveBeenCalledWith(
            'app_cloud_services',
            ['id', 'service_key'],
            [{ id: 1, service_key: 'easelect_com' }],
            { id: 'INTEGER', service_key: 'TEXT' }
        );
        expect(localStorage.getItem('app_cloud_services_view')).toBe('cloud_management');
        expect(localStorage.getItem('app_cloud_services_default_view_seen')).toBe('cloud_management');
        expect(activeContainer.id).toBe('app_cloud_services_cloud_management_view_container');
    });
});
