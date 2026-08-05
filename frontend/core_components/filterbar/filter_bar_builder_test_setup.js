// Shared Vitest/JSDOM setup for filter_bar_builder integration tests.
// Keeps dependency mocks and the representative DOM fixture in one place so
// interaction and transition suites can stay focused and below the line limit.

import { vi } from 'vitest';

const mockUiConfig = vi.hoisted(() => ({
    favefoxFilterLayoutMode: 'inline-open',
    filterbarPanelMode: 'inline-hero',
}));

vi.mock('../admin_tools/admin_button_builder.js', () => ({
    appendChatUIIfAllowed: vi.fn(),
}));

vi.mock('../admin_tools/admin_version_info_indicator.js', () => ({
    buildAdminVersionInfoIndicator: vi.fn(() => {
        const indicator = document.createElement('span');
        indicator.dataset.testid = 'filterbar-admin-version-info';
        return indicator;
    }),
}));

vi.mock('./text_search/create_text_search_panel.js', () => ({
    DEFAULT_TITLE_LANG_KEY_MODE: 'dataset',
    tableMetaCache: new Map(),
    createDatasetSearchPanel: vi.fn((_tableName, options = {}) => {
        const element = document.createElement('div');
        element.classList.add(...(options.panelClasses || ['dataset-search-panel']));
        element.dataset.searchVariant = options.variant || 'filterbar';
        return { element, destroy: vi.fn() };
    }),
}));

vi.mock('./filter_list/filter_column_builder.js', () => ({
    buildFilterSection: vi.fn(() => document.createElement('div')),
}));

vi.mock('./filter_list/favefox_style_filters_container/accordion_filter_builder.js', () => ({
    build_favefox_style_filter_bar_from_columns: vi.fn(() => {
        const wrapper = document.createElement('div');
        wrapper.classList.add('favefox-filterbar-wrapper');
        return wrapper;
    }),
}));

vi.mock('./filter_list/column_view_preset_builder.js', () => ({
    buildColumnViewPresetSelector: vi.fn(() => {
        const row = document.createElement('div');
        row.classList.add('column-preset-row');
        return row;
    }),
}));

vi.mock('../../reusable_components/results_count/results_count_printer.js', () => ({
    setResultsCount: vi.fn(),
}));

vi.mock('./filterbar_engine/filterbar_meta_fetcher.js', () => ({
    fetchTableMeta: vi.fn(),
}));

vi.mock('./filterbar_engine/filterbar_visibility_handler.js', () => ({
    FILTERBAR_BREAKPOINT_PX: 1100,
    ensureFilterOverlay: vi.fn(),
    getStoredVisibility: vi.fn(() => null),
    setStoredVisibility: vi.fn(),
    updateOverlayState: vi.fn(),
}));

vi.mock('./filterbar_visibility_resolver.js', () => ({
    buildInitialResponsivePanelState: vi.fn(() => ({
        shouldShowPanel: true,
        panelManuallyHidden: false,
        autoCollapsedForNarrow: false,
    })),
    resolveResponsivePanelVisibilityState: vi.fn(() => ({
        shouldShowPanel: true,
        autoCollapsedForNarrow: false,
    })),
}));

vi.mock('../../ui_config.js', () => ({
    get FAVEFOX_FILTER_LAYOUT_MODE() {
        return mockUiConfig.favefoxFilterLayoutMode;
    },
    get FILTERBAR_PANEL_MODE() {
        return mockUiConfig.filterbarPanelMode;
    },
    FILTERBAR_COLUMN_WIDTH_PX: 450,
    show_search_only_bar_in_big_card_view: true,
    show_filterbar_search_overview_section: false,
    show_filterbar_search_basic_controls_section: false,
}));

vi.mock('../../reusable_components/scroll_passthrough.js', () => ({
    setupScrollPassthrough: vi.fn(),
}));

vi.mock('./top_row_buttons/top_row_builder.js', () => ({
    ensureTableContainers: vi.fn((tableName) => document.getElementById(`${tableName}_tab_parts_container`)),
    buildTopRow: vi.fn(() => {
        const row = document.createElement('div');
        row.classList.add('dataset-filter-top-grid');
        return row;
    }),
    clearAllFilters: vi.fn(),
}));

vi.mock('./top_row_buttons/sort_dropdown_builder.js', () => ({
    createSortDropdown: vi.fn(() => document.createElement('select')),
}));

vi.mock('../state_stores/table_specs_reader.js', () => ({
    getAllSpecs: vi.fn(() => ({
        demo: {
            display_name: 'Demo',
            search_slogan: 'Search demo',
            icon_key: 'task',
            filterbar_visible_by_default: true,
        },
        riskienhallinta: {
            display_name: 'riskienhallinta',
            icon_key: 'warning',
            filterbar_visible_by_default: true,
        },
    })),
}));

vi.mock('../../icons/icon_mask_builder.js', () => ({
    createMaskIconSpan: vi.fn(() => document.createElement('span')),
}));

vi.mock('../state_stores/lang_preference_reader.js', () => ({
    getLanguageWithBrowserFallback: vi.fn(() => 'en'),
}));

vi.mock('./filterbar_calendar.js', () => ({
    buildCalendarPopup: vi.fn(() => ({ el: document.createElement('div'), destroy: vi.fn() })),
}));

vi.mock('../navigation/menu_button/navbar_visibility_handler.js', () => ({
    NAVBAR_VISIBILITY_CHANGED_EVENT: 'navbar-visibility-changed',
    updateShowMenuButtonPosition: vi.fn(),
}));

vi.mock('./shared_topbar_builder.js', () => ({
    dockButtonIntoSharedTopBar: vi.fn((button, host, owner) => {
        if (!button || !host || !owner) return false;
        button.__sharedTopbarOwner = owner;
        button.classList.add('shared-topbar-docked-button');
        host.replaceChildren(button);
        return true;
    }),
    isSharedTopBarHostActive: vi.fn(() => true),
    restoreButtonFromSharedTopBar: vi.fn((button, owner) => {
        if (!button || button.__sharedTopbarOwner !== owner) return false;
        button.__sharedTopbarOwner = null;
        button.classList.remove('shared-topbar-docked-button');
        document.body.prepend(button);
        return true;
    }),
    shouldShowSharedTopBar: vi.fn(() => false),
}));

export function resetFilterBarBuilderTestDom() {
    vi.resetModules();
    mockUiConfig.favefoxFilterLayoutMode = 'inline-open';
    mockUiConfig.filterbarPanelMode = 'inline-hero';
    document.body.innerHTML = `
        <button id="showMenuButton"></button>
        <button id="hideMenuButton"></button>
        <div id="navbar"></div>
        <div id="demo_container" class="content_div">
            <div id="demo_tab_parts_container" class="tab_parts_container">
                <div class="tab-content-area">
                    <div class="tab-content-body">
                        <div id="demo_card_view_container" class="scrollable_content" style="display: block;"></div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

export function setMockFilterLayoutMode(layoutMode) {
    mockUiConfig.favefoxFilterLayoutMode = layoutMode;
}

export function setMockFilterbarPanelMode(panelMode) {
    mockUiConfig.filterbarPanelMode = panelMode;
}

export function cleanupFilterBarBuilderTestDom() {
    document.getElementById('demo_filterBar_panel')?.destroy?.();
    vi.clearAllMocks();
    vi.useRealTimers();
}
