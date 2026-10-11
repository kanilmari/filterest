// dataset_view_phone_scroll_reset.test.js
// Exercises fresh phone loads with the real persistent hero and toolbar runtime.
// Connects a deferred dataset commit to category focus and responsive toolbar dismissal.
// Guards the complete scroll layout and the phone-to-desktop path exercised by E13.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanupFilterBarBuilderTestDom, resetFilterBarBuilderTestDom } from '../filterbar/filter_bar_builder_test_setup.js';

const { buildView } = vi.hoisted(() => ({ buildView: vi.fn() }));
vi.mock('./dataset_view_renderer.js', () => ({ createDatasetViewElement: buildView }));
vi.mock('./table_view/table_structure_builder.js', () => ({ saveColumnWidths: vi.fn() }));
vi.mock('./map_view/map_view_printer.js', () => ({ dataset_supports_map_view: () => false }));
vi.mock('./dataset_tree_availability_checker.js', () => ({ datasetSupportsTreeView: () => false }));
vi.mock('./view_selector_printer.js', () => ({ applyViewStyling: vi.fn() }));
vi.mock('../route_permission_checker.js', () => ({ hasRoutePermission: () => true }));
vi.mock('../config_fetcher.js', () => ({ getDefaultViewSync: () => 'card' }));
vi.mock('../infinite_scroll/infinite_scroll_handler.js', () => ({
    initializeInfiniteScroll: vi.fn(), seedInfiniteScrollRowCount: vi.fn(), disconnectInfiniteScroll: vi.fn(),
}));
vi.mock('../filterbar/filter_list/active_filter_tag_printer.js', () => ({ renderActiveFilters: vi.fn() }));
vi.mock('../endpoints/endpoint_router.js', () => ({ endpoint_router: vi.fn(async () => ({})) }));
vi.mock('../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js', () => ({
    refreshTableUnified: vi.fn(), invalidateTableRefresh: vi.fn(),
}));
vi.mock('../filterbar/text_search/dataset_search_executor.js', () => ({ do_intelligent_search: vi.fn() }));

const facets = [{ id: 1, slug: 'train', title: { en: 'Train', fi: 'Juna' }, row_count: 2,
    heading: { id: 1, title: { en: 'Transport', fi: 'Liikenne' }, is_single: false } }];
let draw, appearance, viewport;

beforeEach(async () => {
    resetFilterBarBuilderTestDom();
    localStorage.clear(); sessionStorage.clear();
    document.head.innerHTML = '<meta property="og:site_name" content="filt">';
    document.documentElement.lang = 'en';
    document.getElementById('navbar').classList.add('collapsed');
    const tabs = document.createElement('div'); tabs.id = 'tabs_container';
    tabs.append(document.getElementById('demo_container')); document.body.append(tabs);
    viewport = vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(375);
    vi.useFakeTimers();
    const config = await import('../../ui_config.js');
    vi.doMock('../../ui_config.js', async () => ({
        ...await vi.importActual('../../ui_config.js'), ...config, show_search_and_filter_button: false,
    }));
    const specs = await import('../state_stores/table_specs_reader.js');
    vi.doMock('../state_stores/table_specs_reader.js', async () => ({
        ...await vi.importActual('../state_stores/table_specs_reader.js'), ...specs,
    }));
    vi.doMock('../filterbar/shared_topbar_builder.js', () => vi.importActual('../filterbar/shared_topbar_builder.js'));
    vi.doMock('../filterbar/filterbar_visibility_resolver.js', () => vi.importActual('../filterbar/filterbar_visibility_resolver.js'));
    ({ datasetAppearanceState: appearance } = await import('./dataset_appearance_state.js'));
    appearance.clear();
    const { setChosenDatasetView } = await import('../state_stores/dataset_view_choice_saver.js');
    setChosenDatasetView('demo', 'card');
    const { generate_table } = await import('./dataset_view_printer.js');
    draw = () => generate_table('demo', ['id'], [{ id: 1 }], { id: 'integer' }, 2, false, null, null, facets);
    buildView.mockImplementation(() => {
        const view = document.createElement('div'); view.className = 'card_view_wrapper';
        return view;
    });
});

afterEach(async () => {
    const { clearRowGroupFacets } = await import('../filterbar/filter_list/row_group_facet_printer.js');
    clearRowGroupFacets('demo');
    cleanupFilterBarBuilderTestDom(); appearance.clear();
    vi.doUnmock('../../ui_config.js'); vi.doUnmock('../state_stores/table_specs_reader.js');
    vi.doUnmock('../filterbar/shared_topbar_builder.js'); vi.doUnmock('../filterbar/filterbar_visibility_resolver.js');
    vi.restoreAllMocks();
});

test('a fresh phone load resets only after its hero and category controls are mounted', async () => {
    let finish;
    buildView.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = draw();
    const host = document.getElementById('demo_card_view_container');
    const hero = host.querySelector('.filterbar-inline-hero');
    expect(hero).not.toBeNull();
    expect(document.getElementById('demo_tab_parts_container').dataset.view).toBeUndefined();
    expect(host.querySelector('.dataset-results-surface')).toBeNull();
    const writes = [];
    let top = 52;
    Object.defineProperty(host, 'scrollTop', { configurable: true, get: () => top, set: value => {
        top = value;
        writes.push({ top, heroMounted: hero.parentElement === host,
            categoriesMounted: Boolean(host.querySelector('[data-testid="row-group-facet-heading"]')) });
    } });
    finish(document.createElement('div'));
    expect(await pending).toBe(host);
    expect(writes).toEqual([{ top: 0, heroMounted: true, categoriesMounted: true }]);
    expect(hero.parentElement).toBe(host);
    // A category refresh on the same phone surface is not another fresh load.
    host.scrollTop = 52; writes.length = 0;
    const heading = host.querySelector('[data-testid="row-group-facet-heading"]');
    heading.click();
    const popup = document.getElementById(heading.getAttribute('aria-controls'));
    const search = popup.querySelector('input[type="search"]');
    search.focus();
    await draw();
    expect(writes).toEqual([]); expect(host.scrollTop).toBe(52);
    expect(document.activeElement).toBe(search);
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.activeElement).toBe(heading);
    expect(host.scrollTop).toBe(52);
});

test('phone reload then desktop category focus cannot postpone removal of the collapsed toolbar border', async () => {
    await draw();
    const panel = document.getElementById('demo_filterBar_panel');
    const bar = document.querySelector('.dataset-shared-topbar');
    const host = document.getElementById('demo_card_view_container');
    // E13 waits for the initial listing layout before resizing. Complete that
    // observer frame here too, so the counterproof isolates the hide deadline.
    await vi.advanceTimersByTimeAsync(16);
    // The large hero remains visible as E13 expands its initially phone page.
    host.getBoundingClientRect = () => ({ top: 70, bottom: 1000, height: 930 });
    host.querySelector('.filterbar-inline-hero').getBoundingClientRect = () => ({ top: 70, bottom: 770, height: 700 });
    panel.__syncActiveView();
    expect(bar.hidden).toBe(false);
    viewport.mockReturnValue(1440);
    window.dispatchEvent(new Event('resize'));
    await vi.advanceTimersByTimeAsync(150); // The real responsive panel opens its desktop rail.
    expect(bar.classList.contains('dataset-shared-topbar--visible')).toBe(false);
    await vi.advanceTimersByTimeAsync(150);
    // E13 opens/closes a category popup after resizing its initially phone page.
    // The subtree observer resynchronizes the same hidden toolbar on that frame.
    const heading = document.querySelector('[data-testid="row-group-facet-heading"]');
    heading.click();
    panel.__syncActiveView();
    await vi.advanceTimersByTimeAsync(110);
    expect(bar.hidden).toBe(true);
    const popup = document.getElementById(heading.getAttribute('aria-controls'));
    popup.querySelector('input[type="search"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.activeElement).toBe(heading);
    expect(bar.hidden).toBe(true);
});
