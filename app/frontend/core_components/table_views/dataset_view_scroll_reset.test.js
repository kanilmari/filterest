// dataset_view_scroll_reset.test.js
// Verifies viewport changes at the populated dataset-view commit.
// Connects deferred renderers, existing view hosts and retained article returns.
// Keeps fresh surfaces at the top without moving refreshes or abandoned builds.
import { beforeEach, expect, test, vi } from 'vitest';

const { buildView, preserveHost, startScroll } = vi.hoisted(() => ({
    buildView: vi.fn(), preserveHost: vi.fn(), startScroll: vi.fn(),
}));
vi.mock('./dataset_view_renderer.js', () => ({ createDatasetViewElement: buildView }));
vi.mock('./table_view/table_structure_builder.js', () => ({ saveColumnWidths: vi.fn() }));
vi.mock('./map_view/map_view_printer.js', () => ({ dataset_supports_map_view: () => true }));
vi.mock('./dataset_tree_availability_checker.js', () => ({ datasetSupportsTreeView: () => true }));
vi.mock('../navigation/nav_engine/card_article_return_state.js', () => ({ shouldPreserveCardReturnHost: preserveHost }));
vi.mock('../infinite_scroll/infinite_scroll_handler.js', () => ({
    initializeInfiniteScroll: startScroll, seedInfiniteScrollRowCount: vi.fn(), disconnectInfiniteScroll: vi.fn(),
}));
vi.mock('../filterbar/filter_bar_builder.js', () => ({ create_filter_bar: vi.fn() }));
vi.mock('../../reusable_components/results_count/results_count_printer.js', () => ({ setResultsCount: vi.fn() }));
vi.mock('../filterbar/filter_list/active_filter_tag_printer.js', () => ({ renderActiveFilters: vi.fn() }));
vi.mock('../filterbar/filter_list/row_group_facet_printer.js', () => ({ renderRowGroupFacets: vi.fn() }));
vi.mock('./view_selector_printer.js', () => ({ applyViewStyling: vi.fn() }));
vi.mock('../route_permission_checker.js', () => ({ hasRoutePermission: () => true }));
vi.mock('../config_fetcher.js', () => ({ getDefaultViewSync: () => 'card' }));
vi.mock('../../ui_config.js', () => ({ show_search_and_filter_button: false }));

import { generate_table } from './dataset_view_printer.js';
import { datasetAppearanceState } from './dataset_appearance_state.js';
import { getDatasetViewContainerId, RENDERABLE_DATASET_VIEW_DEFINITIONS } from './dataset_view_registry.js';
import { setChosenDatasetView } from '../state_stores/dataset_view_choice_saver.js';

const views = RENDERABLE_DATASET_VIEW_DEFINITIONS.map(definition => definition.viewKey);
const dataset = 'scroll_reset';
const draw = (name = dataset, rows = [{ id: 1 }], options = {}) =>
    generate_table(name, ['id'], rows, { id: 'INTEGER' }, rows.length, false, null, null, null, options);
const hostFor = view => document.getElementById(getDatasetViewContainerId(view, dataset));

beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear(); sessionStorage.clear(); datasetAppearanceState.clear();
    document.body.innerHTML = '<div id="tabs_container"></div>';
    buildView.mockImplementation(() => document.createElement('div'));
    preserveHost.mockReturnValue(false);
});

test.each(views)('starts a new %s surface at the top only when its populated view commits', async view => {
    const previousView = view === 'card' ? 'table' : 'card';
    setChosenDatasetView(dataset, previousView);
    await draw();
    const previousHost = hostFor(previousView);
    previousHost.scrollTop = 820;
    const target = hostFor(view);
    // Hidden hosts can retain their former scroll offset until they get content.
    target.scrollTop = 13000; target.scrollLeft = 45;
    let finish;
    buildView.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    setChosenDatasetView(dataset, view);
    const pending = draw();
    expect(target.scrollTop).toBe(13000);
    expect(previousHost.scrollTop).toBe(820);
    let viewportWhenPagingStarts;
    startScroll.mockImplementationOnce(() => {
        viewportWhenPagingStarts = {
            populated: target.firstElementChild.children.length > 0,
            top: target.scrollTop, left: target.scrollLeft,
        };
    });
    finish(document.createElement('div'));
    expect(await pending).toBe(target);
    expect(target.scrollTop).toBe(0);
    expect(target.scrollLeft).toBe(0);
    expect(viewportWhenPagingStarts).toEqual({ populated: true, top: 0, left: 0 });
});

test('a new dataset resets its reused empty host without moving the dataset left behind', async () => {
    await draw();
    const original = hostFor('card');
    original.scrollTop = 13000;
    let finish;
    buildView.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = draw('another_dataset');
    const target = document.getElementById('another_dataset_card_view_container');
    target.scrollTop = 13000; target.scrollLeft = 25;
    expect(original.scrollTop).toBe(13000);
    finish(document.createElement('div'));
    expect(await pending).toBe(target);
    expect(target.scrollTop).toBe(0);
    expect(target.scrollLeft).toBe(0);
    expect(original.scrollTop).toBe(13000);
});

test.each(views)('keeps the %s viewport through same-surface refresh and empty category results', async view => {
    setChosenDatasetView(dataset, view);
    const host = await draw();
    host.scrollTop = 13000; host.scrollLeft = 45;
    for (const rows of [[{ id: 2 }], []]) {
        expect(await draw(dataset, rows)).toBe(host);
        expect(host.scrollTop).toBe(13000);
        expect(host.scrollLeft).toBe(45);
    }
});

test.each(['abandoned', 'failed'])('%s view builds leave existing scroll positions alone', async outcome => {
    await draw();
    const original = hostFor('card');
    const target = hostFor('table');
    original.scrollTop = 820; target.scrollTop = 13000;
    let finish, reject;
    buildView.mockImplementationOnce(() => new Promise((resolve, refuse) => { finish = resolve; reject = refuse; }));
    setChosenDatasetView(dataset, 'table');
    let current = true;
    const pending = draw(dataset, [{ id: 2 }], { isCurrent: () => current });
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
        if (outcome === 'abandoned') { current = false; finish(document.createElement('div')); }
        else reject(new Error('View build rejected'));
        expect(await pending).toBeNull();
        expect(original.scrollTop).toBe(820);
        expect(target.scrollTop).toBe(13000);
    } finally {
        warning.mockRestore();
    }
});

test('an abandoned view switch cannot turn the next card refresh into a fresh surface', async () => {
    const cards = await draw();
    cards.scrollTop = 13000;
    let finish;
    buildView.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    let current = true;
    setChosenDatasetView(dataset, 'table');
    const pending = draw(dataset, [{ id: 2 }], { isCurrent: () => current });
    current = false; finish(document.createElement('div'));
    expect(await pending).toBeNull();
    setChosenDatasetView(dataset, 'card');
    expect(await draw()).toBe(cards);
    expect(cards.scrollTop).toBe(13000);
});

test('classic article generation preserves the explicitly retained card viewport', async () => {
    await draw();
    const cards = hostFor('card');
    const surface = cards.firstElementChild;
    cards.scrollTop = 13000; cards.scrollLeft = 45;
    const token = {};
    preserveHost.mockImplementation((name, providedToken, host) =>
        name === dataset && providedToken === token && host === cards);
    setChosenDatasetView(dataset, 'article_view');
    await draw(dataset, [{ id: 1 }], { preserveCardReturn: token });
    expect(cards.firstElementChild).toBe(surface);
    expect(cards.scrollTop).toBe(13000);
    expect(cards.scrollLeft).toBe(45);
    // The existing return owner restores this marker with the mounted cards.
    document.getElementById(`${dataset}_tab_parts_container`).dataset.view = 'card';
    cards.style.display = 'block';
    setChosenDatasetView(dataset, 'card');
    expect(await draw()).toBe(cards);
    expect(cards.scrollTop).toBe(13000);
    expect(cards.scrollLeft).toBe(45);
});
