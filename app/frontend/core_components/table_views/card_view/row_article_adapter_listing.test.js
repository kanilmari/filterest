// @vitest-environment jsdom
// Exercises adapter handoffs through real navigation, refresh and Article initialization.
// Stubs network/configuration I/O and DOM builders, leaving opening policy and tickets real.
// Keeps a listing's first row distinct from the requested row to expose automatic opens.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const io = vi.hoisted(() => ({ listing: vi.fn(), article: vi.fn(), shell: vi.fn(), content: vi.fn() }));
vi.mock('../../endpoints/endpoint_data_fetcher.js', () => ({ fetchDatasetData: io.listing }));
vi.mock('./row_article_data_fetcher.js', () => ({ fetchPermittedRowArticleData: io.article }));
vi.mock('./card_view_printer.js', () => ({ create_card_view: io.shell }));
vi.mock('./row_article_content_builder.js', () => ({ buildRowArticleContent: io.content }));
vi.mock('../../endpoints/endpoint_router.js', () => ({ endpoint_router: vi.fn(async () => ({})) }));
vi.mock('../../endpoints/sse_subscriber.js', () => ({ clearSSEActiveDataset: vi.fn(), setSSEActiveDataset: vi.fn() }));
vi.mock('../../navigation/admin_and_user_tools/custom_view_reader.js', () => ({
    custom_views: [], ensure_private_custom_views_loaded: async () => {},
}));
vi.mock('../../config_fetcher.js', () => ({
    getDefaultViewSync: () => 'article_view', getDefaultDatasetSortSync: () => ({ column: 'id', direction: 'ASC' }),
}));
vi.mock('../../route_permission_checker.js', () => ({
    hasRoutePermission: route => route === '/ui/view/article_view', hasDatasetPermission: async () => false,
    primeDatasetPermissions: vi.fn(),
}));
vi.mock('../../user_tools/current_user_profile_fetcher.js', () => ({ fetchCurrentUserProfile: async () => ({ user_id: 1 }) }));
vi.mock('../../lang/translation_handler.js', () => ({ getTranslationForKey: key => key }));
vi.mock('../../dev_tools/function_counter.js', () => ({ count_this_function: vi.fn() }));
vi.mock('../../filterbar/filter_bar_builder.js', () => ({ create_filter_bar: () => null }));
vi.mock('../../filterbar/filter_list/column_visibility_handler.js', () => ({ applyColumnVisibility: vi.fn() }));
vi.mock('../../filterbar/filter_list/active_filter_tag_printer.js', () => ({ renderActiveFilters: vi.fn() }));
vi.mock('../../filterbar/filter_list/row_group_facet_printer.js', () => ({ renderRowGroupFacets: vi.fn() }));
vi.mock('../../infinite_scroll/infinite_scroll_handler.js', () => ({
    initializeInfiniteScroll: vi.fn(), seedInfiniteScrollRowCount: vi.fn(), disconnectInfiniteScroll: vi.fn(),
    resetOffset: vi.fn(), updateOffset: vi.fn(),
}));
vi.mock('../view_selector_printer.js', () => ({ applyViewStyling: vi.fn() }));
vi.mock('../../navigation/nav_engine/browser_tab_title_writer.js', () => ({ updateBrowserTabTitle: vi.fn() }));
vi.mock('../../ai_features/table_chat/table_chat_printer.js', () => ({ destroy_chat: vi.fn() }));
vi.mock('../article_view/article_language_editor.js', () => ({ createArticleLanguageEditor: () => null }));
vi.mock('./row_article_ui_handler.js', () => ({
    closeRowArticle: vi.fn(), dispatchCardArticleToggle: vi.fn(), updateHighlightedCard: vi.fn(), saveScrollBeforeRowArticle: vi.fn(),
}));

import { bindQueryNavigation } from '../compact_dataset_group.js';
import { openRelatedRecord } from './row_article_related_record_opener.js';
import { beginRowPresentationRequest, setRowPresentationChoice } from '../row_presentation/row_presentation_choice.js';
import * as rowPresentationDispatcher from '../row_presentation/row_presentation_dispatcher.js';
import { datasetAppearanceState } from '../dataset_appearance_state.js';
import { getUnifiedTableState, setUnifiedTableState } from '../../state_stores/table_state_store.js';
import { setChosenDatasetView } from '../../state_stores/dataset_view_choice_saver.js';
import { getSelectedDataset, setSelectedDataset } from '../../state_stores/dataset_selection_saver.js';
import { setParams, useUrlParams } from '../../navigation/nav_engine/query_params.js';
import { refreshTableUnified } from '../../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js';
import { handle_all_navigation } from '../../navigation/nav_engine/navigation_handler.js';
import { primeDatasetAccessRegistry, clearDatasetAccessRegistry } from '../../navigation/nav_engine/dataset_access_registry.js';
import { disposeCardResources } from './card_resource_lifecycle.js';

const rows = [{ id: 99, title: 'First listed row' }, { id: 7, title: 'Requested row' }];
const answer = { columns: ['id', 'title'], types: {}, data: rows, row_count: 2 };
const articleIds = () => io.article.mock.calls.map(([request]) => request.rowItem.id);
const activeArticles = () => [...document.querySelectorAll('.active_row_article')].map(element => element._row.id);
const deferred = () => {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
};

function buildShell(_columns, data, dataset, options) {
    // This boundary only builds DOM; the real Article renderer owns state initialization.
    const wrapper = document.createElement('div');
    wrapper.className = 'card_view_wrapper';
    wrapper.dataset.viewKey = options.viewKey;
    wrapper.dataset.tableName = dataset;
    wrapper.innerHTML = '<div class="card_container"></div><div class="row_article_placeholder"></div>';
    for (const row of data) {
        const card = document.createElement('div');
        card.className = 'card'; card.dataset.id = row.id;
        wrapper.firstChild.append(card);
    }
    return wrapper;
}

function activate(adapter) {
    if (adapter === 'related') return openRelatedRecord({
        relatedDataset: 'events', relatedRow: rows[1], parentDataset: 'origin', parentRowId: 1,
        relatedTabsContainer: document.getElementById('related_tabs'),
    });
    const home = adapter === 'Home';
    const link = document.createElement('a');
    link.href = '/events/7';
    document.getElementById('origin_container').append(link);
    bindQueryNavigation(link, 'events', home ? '' : 'query', 7, { preselectArticle: home });
    link.click();
    // Observe the real dispatcher so completion includes the adapter's explicit opener.
    return rowPresentationDispatcher.openDefaultRowPresentation.mock.results.at(-1).value;
}

beforeEach(() => {
    vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear(); datasetAppearanceState.clear(); useUrlParams();
    document.body.innerHTML = '<div id="tabs_container"><div id="origin_container" class="content_div"><div id="related_tabs"></div></div></div>';
    history.replaceState({}, '', '/origin?view=card');
    primeDatasetAccessRegistry({ datasets: [{ table_uid: 7, dataset_name: 'events', names: ['events'], preferred_name: 'events', can_read_rows: true }] });
    setSelectedDataset('origin'); setChosenDatasetView('events', 'article_view'); setParams('events', {});
    setRowPresentationChoice('events', 'article_view');
    // Remembered rows and either old automatic intent must all yield to this handoff.
    setUnifiedTableState('events', { articleView: { collapsed: true, expandedId: 123,
        pendingAutoOpenFirstRenderedResult: true, pendingAutoOpenFirstSearchResult: true } });
    io.listing.mockResolvedValue(answer);
    io.article.mockImplementation(async ({ rowItem }) => rowItem);
    io.shell.mockImplementation(buildShell);
    io.content.mockImplementation(async () => ({ rowArticleContentElement: document.createElement('div') }));
    vi.spyOn(rowPresentationDispatcher, 'openDefaultRowPresentation');
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
});
afterEach(() => {
    disposeCardResources(document.body); document.body.replaceChildren();
    clearDatasetAccessRegistry(); vi.restoreAllMocks(); useUrlParams();
});

test.each(['Home', 'search', 'related'])('%s opens only requested row 7 once through the real Article listing', async adapter => {
    const listing = deferred();
    io.listing.mockReturnValueOnce(listing.promise);
    const pending = activate(adapter);
    await vi.waitFor(() => expect(io.listing).toHaveBeenCalledOnce());
    expect(articleIds()).toEqual([]);
    listing.resolve(answer);
    await pending;
    await vi.waitFor(() => expect(activeArticles()).toEqual([7]));
    expect(articleIds()).toEqual([7]);
    expect(io.content).toHaveBeenCalledOnce();
    expect(io.listing).toHaveBeenCalledOnce();
    expect(io.shell).toHaveBeenCalledExactlyOnceWith(answer.columns, rows, 'events', expect.objectContaining({ viewKey: 'article_view' }));
    expect(document.querySelector('.article_view_wrapper')).not.toBeNull();
});

const staleCases = ['Home', 'search', 'related'].flatMap(adapter =>
    ['newer request', 'history move'].flatMap(reason => ['fetch', 'renderer'].map(phase => [adapter, reason, phase])));
test.each(staleCases)('%s opens no article after %s during %s', async (adapter, reason, phase) => {
    const pause = deferred();
    if (phase === 'fetch') io.listing.mockReturnValueOnce(pause.promise);
    else io.shell.mockImplementationOnce(async (...args) => { await pause.promise; return buildShell(...args); });
    const pending = activate(adapter);
    await vi.waitFor(() => expect(phase === 'fetch' ? io.listing : io.shell).toHaveBeenCalledOnce());
    expect(articleIds()).toEqual([]);
    if (reason === 'newer request') beginRowPresentationRequest('newer');
    else {
        // A real popstate invalidates the ticket even if the address returns to the same entry.
        history.replaceState({}, '', '/history-destination');
        window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
    }
    pause.resolve(answer);
    await pending;
    // Navigation is deliberately allowed to finish despite the expired article request.
    await vi.waitFor(() => expect(getSelectedDataset()).toBe('events'));
    expect(io.shell).toHaveBeenCalledOnce();
    expect(document.querySelector('.article_view_wrapper')).not.toBeNull();
    expect(articleIds()).toEqual([]);
    expect(activeArticles()).toEqual([]);
    expect(io.content).not.toHaveBeenCalled();
    expect(io.listing).toHaveBeenCalledOnce();
    // Revisit in the same tab. Nothing resets the adapter's stored Article state.
    await handle_all_navigation('events', [], { forceReload: true });
    await vi.waitFor(() => expect(activeArticles()).toEqual([99]));
    expect(articleIds()).toEqual([99]);
    expect(io.content).toHaveBeenCalledOnce();
    expect(io.listing).toHaveBeenCalledTimes(2);
});

test('a background listing cannot claim row 99 while the requested row 7 is loading', async () => {
    const rowResponse = deferred();
    io.article.mockReturnValueOnce(rowResponse.promise);
    const opening = activate('Home');
    await vi.waitFor(() => expect(articleIds()).toEqual([7]));
    try {
        await refreshTableUnified('events', { skipUrlParams: true });
        expect(articleIds()).toEqual([7]);
    } finally {
        rowResponse.resolve(rows[1]);
        await opening;
    }
    await vi.waitFor(() => expect(activeArticles()).toEqual([7]));
    expect(articleIds()).toEqual([7]);
});

test('a live refresh during a current same-table listing leaves row 7 to its opener', async () => {
    setSelectedDataset('events');
    const waiting = deferred();
    io.listing.mockReturnValueOnce(waiting.promise);
    const opening = activate('related');
    await vi.waitFor(() => expect(io.listing).toHaveBeenCalledOnce());
    try {
        await refreshTableUnified('events', { skipUrlParams: true });
        expect(articleIds()).toEqual([]);
    } finally {
        waiting.resolve(answer);
        await opening;
    }
    await vi.waitFor(() => expect(activeArticles()).toEqual([7]));
    expect(articleIds()).toEqual([7]);
});

test('an ordinary visit can open row 99 while an expired Home listing is still loading', async () => {
    const oldListing = deferred();
    io.listing.mockReturnValueOnce(oldListing.promise);
    const older = activate('Home');
    await vi.waitFor(() => expect(io.listing).toHaveBeenCalledOnce());
    beginRowPresentationRequest('newer');
    await handle_all_navigation('events', [], { forceReload: true });
    try {
        await vi.waitFor(() => expect(activeArticles()).toEqual([99]));
    } finally {
        oldListing.resolve(answer);
        await older;
    }
    expect(activeArticles()).toEqual([99]);
    expect(articleIds()).toEqual([99]);
});

test('an ordinary non-adapter Article visit still automatically opens first listed row 99 once', async () => {
    setUnifiedTableState('events', { articleView: { collapsed: false, expandedId: null,
        pendingAutoOpenFirstRenderedResult: false, pendingAutoOpenFirstSearchResult: false } });
    await handle_all_navigation('events', [], { forceReload: true });
    await vi.waitFor(() => expect(activeArticles()).toEqual([99]));
    expect(articleIds()).toEqual([99]);
    expect(io.content).toHaveBeenCalledOnce();
    expect(io.listing).toHaveBeenCalledOnce();
    expect(document.querySelector('.article_view_wrapper')).not.toBeNull();
});
