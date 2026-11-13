// @vitest-environment jsdom
// filter_bar_builder_article_topbar.test.js
// Verifies the shared dataset top bar against the real visibility rule, not a stand-in.
// Bridges the selected dataset view with the bar that carries the dataset title,
// the search field and the close control above the content area.
// Exists because an article view whose search matches nothing never opens a row,
// and the bar used to hide itself there, leaving that view with no header at all.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { flushObserverFrame } from './filter_bar_test_environment_builder.js';
import { setChosenDatasetView } from '../state_stores/dataset_view_choice_saver.js';
import {
    cleanupFilterBarBuilderTestDom,
    resetFilterBarBuilderTestDom,
} from './filter_bar_builder_test_setup.js';

/**
 * Points the shared mock at the real visibility rule.
 * The suite that missed this defect forced the rule's answer, so the bar's
 * actual decision was never exercised together with the filterbar that uses it.
 */
async function useRealSharedTopBarRules() {
    const mocked = await import('./shared_topbar_builder.js');
    const actual = await vi.importActual('./shared_topbar_builder.js');
    mocked.shouldShowSharedTopBar.mockImplementation(actual.shouldShowSharedTopBar);
    mocked.isSharedTopBarHostActive.mockImplementation(actual.isSharedTopBarHostActive);
}

function mountDatasetWithBothSidebarsVisible(visibleViewContainerId) {
    document.body.innerHTML = `
        <button id="showMenuButton"></button>
        <button id="hideMenuButton"></button>
        <div id="navbar"></div>
        <div id="demo_container" class="content_div">
            <div id="demo_tab_parts_container" class="tab_parts_container">
                <div class="tab-content-area">
                    <div class="tab-content-body">
                        <div id="demo_card_view_container" class="scrollable_content"
                             style="display: ${visibleViewContainerId === 'demo_card_view_container' ? 'block' : 'none'};"></div>
                        <div id="demo_article_view_container" class="scrollable_content"
                             style="display: ${visibleViewContainerId === 'demo_article_view_container' ? 'block' : 'none'};"></div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

async function buildFilterBarForView(viewKey, { rowCount = 0 } = {}) {
    setChosenDatasetView('demo', viewKey);
    await useRealSharedTopBarRules();
    const { create_filter_bar } = await import('./filter_bar_builder.js');
    create_filter_bar('demo', 'demo_uid', ['id'], { id: 'INTEGER' }, rowCount, false, viewKey);
    await flushObserverFrame();
    return document.querySelector('.dataset-shared-topbar');
}

function isSharedTopBarShowing(sharedTopBar) {
    return Boolean(sharedTopBar)
        && sharedTopBar.hidden === false
        && sharedTopBar.classList.contains('dataset-shared-topbar--visible')
        && sharedTopBar.getAttribute('aria-hidden') === 'false';
}

describe('shared dataset top bar follows the selected view', () => {
    beforeEach(() => {
        resetFilterBarBuilderTestDom();
        localStorage.clear();
        sessionStorage.clear();
        document.head.innerHTML = '<meta property="og:site_name" content="filt">';
    });

    afterEach(() => {
        cleanupFilterBarBuilderTestDom();
    });

    test('an article view with no rows still shows its dataset title and search field', async () => {
        mountDatasetWithBothSidebarsVisible('demo_article_view_container');

        const sharedTopBar = await buildFilterBarForView('article_view', { rowCount: 0 });

        expect(isSharedTopBarShowing(sharedTopBar)).toBe(true);
        expect(sharedTopBar.inert).toBe(false);
        expect(
            sharedTopBar.querySelector('.dataset-shared-topbar__dataset-title')?.textContent
        ).toBe('Demo');
        const searchPanel = sharedTopBar.querySelector(
            '.dataset-shared-topbar__center .dataset-search-panel'
        );
        expect(searchPanel).toBeTruthy();
        expect(searchPanel.dataset.searchVariant).toBe('search-only');
        expect(
            sharedTopBar.querySelector('.dataset-shared-topbar__article-close')?.hidden
        ).toBe(false);
    });

    test('open article panels keep their own controls and focus across a viewport resize', async () => {
        const width = vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1099);
        try {
            mountDatasetWithBothSidebarsVisible('demo_article_view_container');
            const bar = await buildFilterBarForView('article_view');
            const panel = document.getElementById('demo_filterBar_panel');
            const menu = bar.querySelector('[data-testid="shared-topbar-menu-button"]');
            const filterClose = panel.querySelector('.hide_filter_bar_button');
            const content = document.querySelector('#demo_tab_parts_container .tab-content-area');
            filterClose.focus();
            expect(content.style.marginRight).toBe('0px');

            vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
            // Cross the filter breakpoint on every step so the previous layout cannot pass.
            for (const [viewport, reservedWidth] of [[1198, '450px'], [1099, '0px'], [1920, '450px'], [375, '0px']]) {
                width.mockReturnValue(viewport);
                window.dispatchEvent(new Event('resize'));
                await vi.advanceTimersByTimeAsync(150);
                await flushObserverFrame();

                expect(content.style.marginRight).toBe(reservedWidth);
                expect(menu.tabIndex).toBe(-1);
                expect(bar.querySelector('[data-testid="filterbar-toggle"]')).toBeNull();
                expect(filterClose.tabIndex).toBe(0);
                expect(document.activeElement).toBe(filterClose);
                expect(panel.classList.contains('filterbar-panel--hidden')).toBe(false);
            }
        } finally {
            width.mockRestore();
        }
    });

    test('the card view with both sidebars visible keeps the bar away', async () => {
        mountDatasetWithBothSidebarsVisible('demo_card_view_container');

        const sharedTopBar = await buildFilterBarForView('card', { rowCount: 3 });

        expect(isSharedTopBarShowing(sharedTopBar)).toBe(false);
        expect(sharedTopBar.getAttribute('aria-hidden')).toBe('true');
    });

    test('hiding a sidebar still reveals the bar in the card view', async () => {
        mountDatasetWithBothSidebarsVisible('demo_card_view_container');
        document.getElementById('navbar').classList.add('collapsed');

        const sharedTopBar = await buildFilterBarForView('card', { rowCount: 3 });

        expect(isSharedTopBarShowing(sharedTopBar)).toBe(true);
    });

    test('an article view that does open a row is unchanged', async () => {
        mountDatasetWithBothSidebarsVisible('demo_article_view_container');
        const sharedTopBar = await buildFilterBarForView('article_view', { rowCount: 5 });

        expect(isSharedTopBarShowing(sharedTopBar)).toBe(true);

        document.dispatchEvent(new CustomEvent('big-card-toggle', {
            detail: { tableName: 'demo', isOpen: true },
        }));
        await flushObserverFrame();

        expect(isSharedTopBarShowing(sharedTopBar)).toBe(true);
        expect(
            sharedTopBar.querySelector('.dataset-shared-topbar__article-close')?.hidden
        ).toBe(false);
    });

    test('returning to the card view hides the bar again', async () => {
        mountDatasetWithBothSidebarsVisible('demo_article_view_container');
        const articleTopBar = await buildFilterBarForView('article_view', { rowCount: 0 });
        expect(isSharedTopBarShowing(articleTopBar)).toBe(true);

        document.getElementById('demo_filterBar_panel')?.destroy?.();
        mountDatasetWithBothSidebarsVisible('demo_card_view_container');
        const cardTopBar = await buildFilterBarForView('card', { rowCount: 0 });

        expect(isSharedTopBarShowing(cardTopBar)).toBe(false);
    });
});
