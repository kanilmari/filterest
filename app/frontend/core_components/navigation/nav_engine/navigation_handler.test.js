// @vitest-environment jsdom
// navigation_handler.test.js
// Verifies direct navigation keeps database-tree expansion explicit while preserving the opt-in path.
// Bridges performNavigation and a minimal nav-tree DOM so chevrons reflect actual expanded state in jsdom.
// Exists to prevent SVG tabs from unexpectedly opening the database tree unless the navbar setting enables it.

import { beforeEach, describe, expect, test, vi } from 'vitest';

const refreshTableUnifiedMock = vi.fn();
const applyViewStylingMock = vi.fn();
const setSelectedDatasetMock = vi.fn();
const getSelectedDatasetMock = vi.fn();
const getParamsMock = vi.fn();
const updateRecentlyViewedListMock = vi.fn();
const updateRecentlyViewedStatusMock = vi.fn();
const updateActiveHeadingMock = vi.fn();
const runNavigationPipelineMock = vi.fn();
const destroyChatMock = vi.fn();
const clearSSEActiveDatasetMock = vi.fn();
const setSSEActiveDatasetMock = vi.fn();

async function loadModule() {
    vi.resetModules();
    vi.doMock('../../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js', () => ({
        refreshTableUnified: refreshTableUnifiedMock,
    }));
    vi.doMock('../../table_views/view_selector_printer.js', () => ({
        applyViewStyling: applyViewStylingMock,
    }));
    vi.doMock('../../state_stores/dataset_selection_saver.js', () => ({
        setSelectedDataset: setSelectedDatasetMock,
        getSelectedDataset: getSelectedDatasetMock,
    }));
    vi.doMock('./query_params.js', () => ({
        getParams: getParamsMock,
        DATASET_PREFIX: '/app_',
        useStorageParams: vi.fn(),
        useUrlParams: vi.fn(),
    }));
    vi.doMock('./recent_tab_saver.js', () => ({
        update_recently_viewed_list: updateRecentlyViewedListMock,
        update_recently_viewed_status: updateRecentlyViewedStatusMock,
    }));
    vi.doMock('./active_heading_updater.js', () => ({
        update_active_heading: updateActiveHeadingMock,
    }));
    vi.doMock('../../pipeline/navigation_pipeline.js', () => ({
        runNavigationPipeline: runNavigationPipelineMock,
    }));
    vi.doMock('../../ai_features/table_chat/table_chat_printer.js', () => ({
        destroy_chat: destroyChatMock,
    }));
    vi.doMock('../../endpoints/sse_subscriber.js', () => ({
        clearSSEActiveDataset: clearSSEActiveDatasetMock,
        setSSEActiveDataset: setSSEActiveDatasetMock,
    }));

    return import('./navigation_handler.js');
}

describe('navigation_handler', () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <div id="nav_tree">
                <div class="node" id="tree_node_database_nav" data-expanded="false">
                    <div class="node-row">
                        <div class="toggle" aria-expanded="false"></div>
                        <span>Tietokanta</span>
                    </div>
                    <div class="children" hidden style="height: 0px;">
                        <div class="node" id="tree_node_orders_nav">
                            <div class="node-row">
                                <div class="toggle" aria-expanded="false"></div>
                                <button class="general_button_nav" data-lang-key="orders">Orders</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <div id="tabs_container">
                <div class="content_div hidden"></div>
                <div id="orders_container" class="content_div hidden"></div>
                <div id="permissions_container" class="content_div hidden"></div>
            </div>
            <div id="navbar"></div>
            <div id="navmenu" class="navtabs">
                <button class="navtablinks active" data-id="app_service_catalog" data-tab-presentation="button-active">
                    <svg class="svg-container"><path d="active" fill="var(--bg_color_2)" stroke-width="2"></path></svg>
                </button>
                <button class="navtablinks" data-id="orders" data-tab-presentation="button-inactive">
                    <svg class="svg-container"><path d="inactive" fill="none" stroke-width="2"></path></svg>
                </button>
            </div>
        `;

        refreshTableUnifiedMock.mockReset();
        applyViewStylingMock.mockReset();
        setSelectedDatasetMock.mockReset();
        getSelectedDatasetMock.mockReset();
        getParamsMock.mockReset();
        updateRecentlyViewedListMock.mockReset();
        updateRecentlyViewedStatusMock.mockReset();
        updateActiveHeadingMock.mockReset();
        runNavigationPipelineMock.mockReset();
        destroyChatMock.mockReset();
        clearSSEActiveDatasetMock.mockReset();
        setSSEActiveDatasetMock.mockReset();
        delete window.easelectNavbarSettings;

        refreshTableUnifiedMock.mockResolvedValue(undefined);
        getSelectedDatasetMock.mockReturnValue(null);
        getParamsMock.mockReturnValue({});

        const folderNode = document.getElementById('tree_node_database_nav');
        const folderChildren = folderNode.querySelector(':scope > .children');
        const folderToggle = folderNode.querySelector(':scope > .node-row > .toggle');

        folderToggle.addEventListener('click', () => {
            const nextExpanded = folderToggle.getAttribute('aria-expanded') !== 'true';
            folderToggle.setAttribute('aria-expanded', String(nextExpanded));
            folderToggle.classList.toggle('rotated', nextExpanded);
            folderChildren.hidden = !nextExpanded;
            folderChildren.style.height = nextExpanded ? 'auto' : '0px';
            folderNode.dataset.expanded = String(nextExpanded);
        });
    });

    test('does not open collapsed database-tree ancestors by default', async () => {
        const { performNavigation } = await loadModule();
        const loadFunction = vi.fn().mockResolvedValue(undefined);

        await performNavigation('orders', 'orders_container', loadFunction, 'database', false);

        const folderNode = document.getElementById('tree_node_database_nav');
        const folderChildren = folderNode.querySelector(':scope > .children');
        const folderToggle = folderNode.querySelector(':scope > .node-row > .toggle');
        const ordersButton = document.querySelector('.general_button_nav[data-lang-key="orders"]');

        expect(folderNode.dataset.expanded).toBe('false');
        expect(folderChildren.hidden).toBe(true);
        expect(folderToggle.getAttribute('aria-expanded')).toBe('false');
        expect(folderToggle.classList.contains('rotated')).toBe(false);
        expect(ordersButton.classList.contains('active')).toBe(true);
        expect(loadFunction).toHaveBeenCalledTimes(1);
        expect(setSelectedDatasetMock).toHaveBeenCalledWith('orders');
        expect(setSSEActiveDatasetMock).toHaveBeenCalledWith('orders');
        expect(document.querySelector('.navtablinks[data-id="orders"]')?.classList.contains('active')).toBe(true);
        expect(document.querySelector('.navtablinks[data-id="app_service_catalog"]')?.classList.contains('active')).toBe(false);
    });

    test('opens collapsed database-tree ancestors when navbar setting enables it', async () => {
        window.easelectNavbarSettings = {
            autoExpandDatabaseTreeOnNavigation: true,
        };
        const { performNavigation } = await loadModule();
        const loadFunction = vi.fn().mockResolvedValue(undefined);

        await performNavigation('orders', 'orders_container', loadFunction, 'database', false);

        const folderNode = document.getElementById('tree_node_database_nav');
        const folderChildren = folderNode.querySelector(':scope > .children');
        const folderToggle = folderNode.querySelector(':scope > .node-row > .toggle');
        const ordersButton = document.querySelector('.general_button_nav[data-lang-key="orders"]');

        expect(folderNode.dataset.expanded).toBe('true');
        expect(folderChildren.hidden).toBe(false);
        expect(folderToggle.getAttribute('aria-expanded')).toBe('true');
        expect(folderToggle.classList.contains('rotated')).toBe(true);
        expect(ordersButton.classList.contains('active')).toBe(true);
        expect(loadFunction).toHaveBeenCalledTimes(1);
        expect(setSelectedDatasetMock).toHaveBeenCalledWith('orders');
        expect(setSSEActiveDatasetMock).toHaveBeenCalledWith('orders');
    });

    test('clears SVG tab active state when navigating to a custom tool view', async () => {
        const { performNavigation } = await loadModule();
        const loadFunction = vi.fn().mockResolvedValue(undefined);

        await performNavigation('permissions', 'permissions_container', loadFunction, 'admin_tools', true);

        expect(document.querySelector('.navtablinks.active')).toBeNull();
        expect(document.querySelector('.navtablinks[data-id="app_service_catalog"]')?.dataset.tabPresentation)
            .toBe('button-inactive');
        expect(clearSSEActiveDatasetMock).toHaveBeenCalledTimes(1);
        expect(setSelectedDatasetMock).not.toHaveBeenCalled();
    });
});
