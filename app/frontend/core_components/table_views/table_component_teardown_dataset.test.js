// @vitest-environment jsdom
// table_component_teardown_dataset.test.js
// Verifies explicit disposal through the application's real dataset renderer.
// Connects real TableComponent resources with failed and superseded view assembly.
// Keeps roots unseen by the removal observer from retaining menus and listeners.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { setChosenDatasetView } from '../state_stores/dataset_view_choice_saver.js';

const createTableElementMock = vi.fn(() => document.createElement('div'));
const saveColumnWidthsMock = vi.fn();
const createCardViewMock = vi.fn();
const initializeInfiniteScrollMock = vi.fn();
const seedInfiniteScrollRowCountMock = vi.fn();
const createFilterBarMock = vi.fn();
const setResultsCountMock = vi.fn();
const renderActiveFiltersMock = vi.fn();
const renderRowGroupFacetsMock = vi.fn();
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
    disconnectInfiniteScroll: vi.fn(),
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

vi.mock('../filterbar/filter_list/row_group_facet_printer.js', () => ({
    renderRowGroupFacets: renderRowGroupFacetsMock,
}));

vi.mock('./tree_view/tree_view_printer.js', () => ({
    create_tree_view: createTreeViewMock,
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

vi.mock('../state_stores/table_specs_reader.js', async original => ({
    ...await original(),
    getAllSpecs: getAllSpecsMock,
}));

vi.mock('../dev_tools/function_counter.js', () => ({ count_this_function: vi.fn() }));
vi.mock('../function_access_checker.js', () => ({ logAndCheckAccess: vi.fn() }));
vi.mock('../lang/translation_handler.js', () => ({ getTranslationForKey: key => key }));
vi.mock('../general_tables/gt_1_row_crud/gt_1_3_row_update/cell_editor.js', () => ({ editCell: vi.fn() }));
vi.mock('../error_and_status_handling/request_failure_notice.js', () => ({
    showRequestFailureNotice: () => {
        const element = document.createElement('div');
        element.innerHTML = '<span class="toast-notification-text">Failure</span>';
        return { element };
    },
}));

import { TableComponent } from './table_component_builder.js';

const components = [];

beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '<div id="tabs_container"></div>';
    localStorage.clear();
    sessionStorage.clear();
    getDefaultViewSyncMock.mockReturnValue('normal');
    setChosenDatasetView('people', 'normal');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    components.splice(0).forEach(component => component.destroy());
    vi.restoreAllMocks();
    document.body.replaceChildren();
});

describe('TableComponent dataset renderer disposal', () => {
    test.each(['same-task mounted failure', 'superseded detached build', 'failed pending build'])(
        '%s releases a component never seen connected by its observer', async removalPath => {
            const { generate_table } = await import('./dataset_view_printer.js');
            let current = true;
            let component;
            let menu;
            if (removalPath === 'superseded detached build') {
                createFilterBarMock.mockImplementationOnce(() => { current = false; });
            } else if (removalPath === 'failed pending build') {
                createFilterBarMock.mockImplementationOnce(() => { throw new Error('Filter bar build failed'); });
            } else {
                renderActiveFiltersMock.mockImplementationOnce(() => {
                    expect(document.body.contains(component.getElement())).toBe(true);
                    component.showSelectionMenu(40, 80);
                    expect(menu.parentNode).toBe(document.body);
                    throw new Error('Mounted controls build failed');
                });
            }
            const getElement = vi.spyOn(TableComponent.prototype, 'getElement');
            const disconnectObserver = vi.spyOn(MutationObserver.prototype, 'disconnect');
            const rendering = generate_table('people', ['name'], [{ id: 1, name: 'Ada' }],
                { name: 'TEXT' }, 1, false, null, null, null, { isCurrent: () => current });
            const root = getElement.mock.results[0].value;
            component = root.tableComponentInstance;
            components.push(component);
            menu = component.selectionMenu;
            const connectionChecks = vi.spyOn(root, 'isConnected', 'get');
            const destroy = vi.spyOn(component, 'destroy');
            const copySelected = vi.spyOn(component, 'copySelected').mockImplementation(() => {});
            const onCellClick = vi.spyOn(component, 'onCellClick').mockImplementation(() => {});

            expect(await rendering).toBeNull();
            expect(connectionChecks.mock.results.some(check => check.value === true)).toBe(false);
            // Explicit disposal must finish before the caller regains control.
            expect(destroy).toHaveBeenCalledTimes(1);
            expect(disconnectObserver).toHaveBeenCalledTimes(1);
            expect(root.tableComponentInstance).toBeUndefined();
            expect(root.parentNode).toBeNull();
            expect(menu.parentNode).toBeNull();
            expect(document.body.querySelectorAll(':scope > .selection-menu')).toHaveLength(0);
            menu.querySelector('[data-action="copy-no-headers"]').click();
            root.click();
            expect(copySelected).not.toHaveBeenCalled();
            expect(onCellClick).not.toHaveBeenCalled();
            await Promise.resolve();
            expect(destroy).toHaveBeenCalledTimes(1);
        }
    );
});
