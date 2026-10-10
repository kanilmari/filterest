// @vitest-environment jsdom
// dataset_view_printer.test.js
// Verifies dataset view assembly ordering for the shared filterbar and active view.
// Bridges mocked view builders and the real generate_table orchestration in jsdom.
// Exists to keep filterbar rendering from regressing behind slow async view builders.

import { beforeEach, describe, expect, test, vi } from 'vitest';
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

vi.mock('../state_stores/table_specs_reader.js', async original => ({
    ...await original(),
    getAllSpecs: getAllSpecsMock,
}));

describe('generate_table', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        document.body.innerHTML = '<div id="tabs_container"></div>';
        localStorage.clear();
        sessionStorage.clear();
        createCardViewMock.mockImplementation(() => document.createElement('div'));
        createMapViewMock.mockImplementation(() => document.createElement('div'));
        createPriceChartViewMock.mockImplementation(() => document.createElement('div'));
        createCloudManagementViewMock.mockImplementation(() => document.createElement('div'));
        datasetSupportsMapViewMock.mockReturnValue(true);
        hasRoutePermissionMock.mockReturnValue(true);
        getAllSpecsMock.mockReturnValue({});
        getDefaultViewSyncMock.mockReturnValue('card');
    });

    test('uses an empty results snapshot to scope the content before rendering and retains current appearance on row reuse', async () => {
        const { DEFAULT_DATASET_APPEARANCE } = await import('../../shared/dataset_appearance/validator.js');
        const { datasetAppearanceState } = await import('./dataset_appearance_state.js');
        const { generate_table } = await import('./dataset_view_printer.js');
        const effective = JSON.parse(JSON.stringify(DEFAULT_DATASET_APPEARANCE));
        effective.light.image_blur = 8;
        const appearance = { dataset_uid: 71, schema_version: 1, version: '1', shared_version: 'site-1',
            overrides: { 'light.image_blur': 8 }, effective };
        await generate_table('empty', ['id'], [], {}, 0, false, null, null, null, { datasetAppearance: appearance });
        expect(document.getElementById('empty_container').dataset.datasetAppearanceUid).toBe('71');
        expect(document.getElementById('empty_container').style.getPropertyValue('--dataset-background-light-image-blur')).toBe('8px');
        effective.light.image_blur = 12;
        datasetAppearanceState.accept('empty', { ...appearance, version: '2', overrides: { 'light.image_blur': 12 }, effective });
        await generate_table('empty', ['id'], [], {}, 0, false, null, null, null,
            { datasetAppearance: appearance, loadedRows: { offset: 0 } });
        expect(document.getElementById('empty_container').style.getPropertyValue('--dataset-background-light-image-blur')).toBe('12px');
        expect(document.documentElement.style.getPropertyValue('--dataset-background-light-image-blur')).toBe('');
    });

	test('uses presentation media returned with dataset results without admin tree metadata', async () => {
		setChosenDatasetView('demo_dataset', 'card');
		getAllSpecsMock.mockReturnValue({});

		const { generate_table } = await import('./dataset_view_printer.js');
		await generate_table(
			'demo_dataset',
			['id'],
			[{ id: 1 }],
			{ id: 'INTEGER' },
			1,
			false,
			null,
			{
				background_image_path: '/storage/104/dataset_media/background/original/background.webp',
			}
		);

		const contentArea = document.querySelector('.tab-content-area');
		expect(contentArea).not.toBeNull();
		expect(contentArea.classList.contains('tab-content-area--has-dataset-background')).toBe(true);
		expect(contentArea.style.getPropertyValue('--dataset-background-image'))
			.toContain('/storage/104/dataset_media/background/2160/background.webp');
		expect(document.querySelector('.dataset-results-surface')).not.toBeNull();
	});


    test.each([
        [null, true, false],
        [null, false, true],
        [{ background_image_path: '/storage/104/dataset_media/background/original/new.webp', background_image_hidden: true }, false, false],
        [{ background_image_path: '/storage/104/dataset_media/background/original/new.webp', background_image_hidden: false }, true, true],
        [{ background_image_path: '' }, false, false],
    ])('background response %j owns visibility over cached flag %s', async (presentation, cachedHidden, visible) => {
        setChosenDatasetView('demo_dataset', 'card');
        getAllSpecsMock.mockReturnValue({ demo_dataset: {
            dataset_background_image_path: '/storage/104/dataset_media/background/original/old.webp',
            dataset_background_image_hidden: cachedHidden,
        } });
        const { generate_table } = await import('./dataset_view_printer.js');
        await generate_table('demo_dataset', ['id'], [{ id: 1 }], { id: 'INTEGER' }, 1, false, null, presentation);
        const content = document.querySelector('.tab-content-area');
        expect(content.classList.contains('tab-content-area--has-dataset-background')).toBe(visible);
        expect(Boolean(content.style.getPropertyValue('--dataset-background-image'))).toBe(visible);
        if (presentation?.background_image_path && visible) {
            expect(content.style.getPropertyValue('--dataset-background-image')).toContain('new.webp');
        }
    });

    test.each([null, {card_style_variant: null}, {card_style_variant: 'standard'}])('retains style inheritance or an explicit override from metadata %j', async tableMeta => {
        setChosenDatasetView('demo_dataset', 'card');
        const { generate_table } = await import('./dataset_view_printer.js');
        await generate_table('demo_dataset', ['id'], [{id: 1}], {id: 'INTEGER'}, 1, false, tableMeta);
        expect(JSON.parse(localStorage.getItem('demo_dataset_tableMeta')).card_style_variant)
            .toBe(tableMeta?.card_style_variant ?? null);
        expect(createCardViewMock).toHaveBeenCalled();
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

        setChosenDatasetView('demo_dataset', 'card');

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

    test('creates the result-count mirror before filling the initial dataset count', async () => {
        const events = [];
        renderActiveFiltersMock.mockImplementationOnce(() => {
            events.push('create-count-mirror');
        });
        setResultsCountMock.mockImplementationOnce(() => {
            events.push('fill-count');
        });
        setChosenDatasetView('demo_dataset', 'card');

        const { generate_table } = await import('./dataset_view_printer.js');
        await generate_table(
            'demo_dataset',
            ['id'],
            [{ id: 1 }],
            { id: 'INTEGER' },
            1,
            false,
            null
        );

        expect(events).toEqual(['create-count-mirror', 'fill-count']);
        expect(setResultsCountMock).toHaveBeenCalledWith('demo_dataset', 1);
    });

    test('renders first-page row-group metadata in the controls shared by all views', async () => {
        setChosenDatasetView('demo_dataset', 'table');
        const facets = [
            { id: 4, slug: 'security', title: { en: 'Security' }, row_count: 3 },
        ];

        const { generate_table } = await import('./dataset_view_printer.js');
        await generate_table(
            'demo_dataset',
            ['id'],
            [{ id: 1 }],
            { id: 'INTEGER' },
            1,
            false,
            null,
            null,
            facets
        );

        expect(renderRowGroupFacetsMock).toHaveBeenCalledWith('demo_dataset', facets, {});
        expect(renderRowGroupFacetsMock.mock.invocationCallOrder[0]).toBeLessThan(
            renderActiveFiltersMock.mock.invocationCallOrder[0]
        );
        expect(renderActiveFiltersMock.mock.invocationCallOrder[0]).toBeLessThan(
            setResultsCountMock.mock.invocationCallOrder[0]
        );
    });

    test('retains the category host and focused control across a full dataset redraw', async () => {
        const { generate_table } = await import('./dataset_view_printer.js');
        setChosenDatasetView('demo_dataset', 'table');
        await generate_table('demo_dataset', ['id'], [{ id: 1 }], { id: 'INTEGER' }, 1, false, null);
        const controls = document.getElementById('demo_dataset_card_top_controls');
        const panel = document.createElement('div');
        panel.id = 'demo_dataset_row_group_facets';
        panel.rowGroupPanelState = { openHeading: '1', searches: new Map([['1', 'boat']]) };
        const trigger = document.createElement('button');
        trigger.textContent = 'Heading';
        panel.appendChild(trigger);
        controls.appendChild(panel);
        const { createMultiselectDropdown } = await import('../../reusable_components/multiselect_dropdown/multiselect_dropdown_builder.js');
        const dropdown = createMultiselectDropdown({
            containerElement: panel, triggerElement: trigger,
            ownerElement: controls.closest('#tabs_container > .content_div'),
            options: [{ value: 'boat', label: 'Boat', count: 1 }],
            popupHeader: { title: 'Heading', showCloseButton: true }, allowExclude: false, preserveViewState: true,
        });
        dropdown.open();
        const popup = document.getElementById(trigger.getAttribute('aria-controls'));
        const option = popup.querySelector('[role="option"]');
        option.focus();
        let finishRenderer;
        createTableElementMock.mockImplementationOnce(() => new Promise(resolve => { finishRenderer = resolve; }));
        const redraw = generate_table('demo_dataset', ['id'], [{ id: 2 }], { id: 'INTEGER' }, 1, false, null);
        await vi.waitFor(() => expect(finishRenderer).toBeTypeOf('function'));
        await new Promise(resolve => setTimeout(resolve, 25));
        expect(controls.isConnected).toBe(false);
        expect(popup.isConnected).toBe(true);
        expect(popup.style.display).toBe('flex');
        expect(document.activeElement).toBe(option);
        finishRenderer(document.createElement('div'));
        await redraw;
        expect(document.getElementById('demo_dataset_card_top_controls')).toBe(controls);
        expect(document.getElementById('demo_dataset_row_group_facets')).toBe(panel);
        expect(panel.rowGroupPanelState.openHeading).toBe('1');
        expect(panel.rowGroupPanelState.searches.get('1')).toBe('boat');
        expect(document.activeElement).toBe(option);
        expect(popup.isConnected).toBe(true);
        dropdown.destroy();
    });

    test('falls back from map view when the dataset has no map-capable fields', async () => {
        datasetSupportsMapViewMock.mockReturnValueOnce(false);
        setChosenDatasetView('demo_dataset', 'map');

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
            'demo_dataset',
            { isCurrent: expect.any(Function) }
        );
        expect(sessionStorage.getItem('demo_dataset_view')).toBe('card');
        expect(activeContainer.id).toBe('demo_dataset_card_view_container');
    });

    test('keeps map view when the dataset has geospatial support', async () => {
        datasetSupportsMapViewMock.mockReturnValueOnce(true);
        setChosenDatasetView('demo_dataset', 'map');

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
        expect(sessionStorage.getItem('demo_dataset_view')).toBe('map');
        expect(activeContainer.id).toBe('demo_dataset_map_view_container');
    });

    test('passes multilingual column metadata to the tree view', async () => {
        setChosenDatasetView('demo_dataset', 'tree');
        const rows = [{ id: 1, parent_id: null, name: '{"en":"English","fi":"Suomi"}' }];
        const dataTypes = {
            id: { data_type: 'integer' },
            parent_id: {
                data_type: 'integer',
                foreign_table: 'demo_dataset',
                foreign_column: 'id',
            },
            name: { data_type: 'text', is_multilingual: true },
        };

        const { generate_table } = await import('./dataset_view_printer.js');
        await generate_table(
            'demo_dataset',
            ['id', 'parent_id', 'name'],
            rows,
            dataTypes,
            1,
            false,
            null
        );

        expect(createTreeViewMock).toHaveBeenCalledWith(
            'demo_dataset',
            ['id', 'parent_id', 'name'],
            rows,
            dataTypes
        );
    });

    test('falls back from tree view when the dataset has no verified hierarchy', async () => {
        setChosenDatasetView('demo_dataset', 'tree');

        const { generate_table } = await import('./dataset_view_printer.js');
        const activeContainer = await generate_table(
            'demo_dataset',
            ['id', 'parent_id', 'title'],
            [{ id: 1, parent_id: null, title: 'Flat row' }],
            {
                id: { data_type: 'integer' },
                parent_id: { data_type: 'integer' },
                title: { data_type: 'text' },
            },
            1,
            false,
            null
        );

        expect(createTreeViewMock).not.toHaveBeenCalled();
        expect(createCardViewMock).toHaveBeenCalled();
        expect(sessionStorage.getItem('demo_dataset_view')).toBe('card');
        expect(activeContainer.id).toBe('demo_dataset_card_view_container');
    });

    test('renders price chart view when selected', async () => {
        setChosenDatasetView('demo_dataset', 'price_chart');

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
        setChosenDatasetView('demo_dataset', 'article');

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
            'demo_dataset',
            { viewKey: 'article_view', stateKey: 'articleView', isCurrent: expect.any(Function) }
        );
        expect(sessionStorage.getItem('demo_dataset_view')).toBe('article_view');
        expect(activeContainer.id).toBe('demo_dataset_article_view_container');
    });

    test('falls back from stale non-renderable view keys', async () => {
        setChosenDatasetView('demo_dataset', 'legacy_magic_view');

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
            'demo_dataset',
            { isCurrent: expect.any(Function) }
        );
        expect(sessionStorage.getItem('demo_dataset_view')).toBe('card');
        expect(activeContainer.id).toBe('demo_dataset_card_view_container');
    });

    test.each([
        ['fresh reader without admin tree', {}, null, 'table', 'table'],
        ['read metadata wins a stale tree', { default_view_name: 'article_view' }, null, 'table', 'table'],
        ['explicit article remains selected', {}, 'article_view', 'table', 'article_view'],
        ['saved card selection remains selected', {}, 'card', 'table', 'card'],
        ['empty dataset default uses site default', { default_view_name: 'article_view' }, null, null, 'card'],
    ])('%s', async (_name, spec, stored, defaultView, expected) => {
        getAllSpecsMock.mockReturnValue({ demo_dataset: spec });
        if (stored) setChosenDatasetView('demo_dataset', stored);
        const { generate_table } = await import('./dataset_view_printer.js');
        const active = await generate_table('demo_dataset', ['id'], [{ id: 1 }],
            { id: 'INTEGER' }, 1, false, { default_view_name: defaultView });
        expect(sessionStorage.getItem('demo_dataset_view')).toBe(expected);
        expect(active.id).toBe(expected === 'article_view'
            ? 'demo_dataset_article_view_container' : `demo_dataset_${expected}_view_container`);
    });

    test.each([null, 'article_view', 'card'])('uses the reader default with no extra route grants (stored=%s)', async stored => {
        hasRoutePermissionMock.mockReturnValue(false);
        getAllSpecsMock.mockReturnValue({});
        if (stored) setChosenDatasetView('demo_dataset', stored);
        const { generate_table } = await import('./dataset_view_printer.js');
        const active = await generate_table('demo_dataset', ['id'], [{ id: 1 }],
            { id: 'INTEGER' }, 1, false, { default_view_name: 'table' });
        expect(active.id).toBe('demo_dataset_table_view_container');
        expect(sessionStorage.getItem('demo_dataset_view')).toBe('table');
    });

    test('does not restore an unsupported default after permission fallback', async () => {
        datasetSupportsMapViewMock.mockReturnValue(false);
        hasRoutePermissionMock.mockReturnValue(false);
        const { generate_table } = await import('./dataset_view_printer.js');
        const active = await generate_table('demo_dataset', ['id'], [{ id: 1 }],
            { id: 'INTEGER' }, 1, false, { default_view_name: 'map' });
        expect(active.id).toBe('demo_dataset_card_view_container');
        expect(createMapViewMock).not.toHaveBeenCalled();
        expect(sessionStorage.getItem('demo_dataset_view')).toBe('card');
    });

    // Page load forgets earlier visits' views (load_tables), so a cloud-management
    // default needs no migration of its own: it applies whenever nothing was
    // chosen in this visit. The drawn view is this tab's own (K143), so it never
    // reaches the storage every tab shares.
    test('opens a cloud-management dataset in its default when nothing was chosen this visit', async () => {
        getAllSpecsMock.mockReturnValue({
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
        expect(sessionStorage.getItem('app_cloud_services_view')).toBe('cloud_management');
        expect(localStorage.getItem('app_cloud_services_view')).toBeNull();
        expect(activeContainer.id).toBe('app_cloud_services_cloud_management_view_container');
    });

    // A browser that refuses session storage keeps this page's chosen view in
    // memory (tab_session_storage.js): a chosen view is drawn, otherwise the
    // dataset's default, and nothing throws.
    test.each([[null, 'table'], ['card', 'card']])('draws the chosen view (%s), else the default, in a browser that refuses session storage', async (chosen, expected) => {
        const refuse = () => { throw new DOMException('The operation is insecure.', 'SecurityError'); };
        vi.stubGlobal('sessionStorage', { getItem: refuse, setItem: refuse, removeItem: refuse, clear: refuse, key: refuse, length: 0 });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            const { generate_table } = await import('./dataset_view_printer.js');
            const { setChosenDatasetView } = await import('../state_stores/dataset_view_choice_saver.js');
            if (chosen) setChosenDatasetView('demo_dataset', chosen);
            const active = await generate_table('demo_dataset', ['id'], [{ id: 1 }],
                { id: 'INTEGER' }, 1, false, { default_view_name: 'table' });
            expect(active?.id).toBe(`demo_dataset_${expected}_view_container`);
        } finally {
            warn.mockRestore();
            vi.unstubAllGlobals();
        }
    });

    test("only an explicitly retained card host survives classic article generation", async () => {
        setChosenDatasetView("events", "card");
        createCardViewMock.mockImplementation(() => {
            const card = document.createElement("div");
            card.className = "card_view_wrapper";
            card.textContent = "Original row";
            return card;
        });
        const { generate_table } = await import("./dataset_view_printer.js");
        await generate_table("events", ["id"], [{ id: 3 }], { id: "INTEGER" }, 100);
        const host = document.getElementById("events_card_view_container");
        const original = host.querySelector(".card_view_wrapper");
        const { shouldPreserveCardReturnHost } = await import("../navigation/nav_engine/card_article_return_state.js");
        const token = {};
        shouldPreserveCardReturnHost.mockImplementation((dataset, providedToken, candidate) =>
            dataset === "events" && providedToken === token && candidate === host);
        setChosenDatasetView("events", "article_view");
        await generate_table("events", ["id", "description"], [{ id: 3 }], { description: "TEXT" }, 100, false, null, null, null, { preserveCardReturn: token });
        expect(host.contains(original)).toBe(true);
        expect(host.style.display).toBe("none");
        // An ordinary refresh must still release the old card surface.
        await generate_table("events", ["id"], [{ id: 3 }], {}, 100);
        expect(original.isConnected).toBe(false);
    });

    test.each(['card', 'table'])('records the initial %s rows for a later article transfer', async view => {
        setChosenDatasetView('events', view);
        const { generate_table } = await import('./dataset_view_printer.js');
        const { setUnifiedTableState } = await import('../state_stores/table_state_store.js');
        const loaded = await import('./dataset_loaded_rows.js');
        const registry = await import('../navigation/nav_engine/dataset_access_registry.js');
        registry.primeDatasetAccessRegistry({ datasets: [{ dataset_name: 'events' }] });
        setUnifiedTableState('events', { offset: 2 });
        await generate_table('events', ['id'], [{ id: 1 }, { id: 2 }], { id: 'INTEGER' }, 8, false, { default_view_name: view });
        const token = loaded.captureLoadedDatasetRows('events');
        expect(token).not.toBeNull();
        setChosenDatasetView('events', 'article_view');
        expect(loaded.resolveLoadedDatasetRows('events', token)).toMatchObject({
            projectionView: view, offset: 2, result: { data: [{ id: 1 }, { id: 2 }] },
        });
    });

});

vi.mock("../navigation/nav_engine/card_article_return_state.js", () => ({ shouldPreserveCardReturnHost: vi.fn(() => false) }));
