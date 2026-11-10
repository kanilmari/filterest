// @vitest-environment jsdom
// Exercises the dispatcher, classic opener and refresh together with deferred I/O.
// Keeps cancellation attached to both the listing rebuild and its subsequent article.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const io = vi.hoisted(() => ({ fetchRows: vi.fn(), render: vi.fn(), fetchArticle: vi.fn(), content: vi.fn() }));
vi.mock('../../endpoints/endpoint_data_fetcher.js', () => ({ fetchDatasetData: io.fetchRows }));
vi.mock('../dataset_view_printer.js', () => ({ generate_table: io.render }));
vi.mock('./row_article_data_fetcher.js', () => ({ fetchPermittedRowArticleData: io.fetchArticle }));
vi.mock('./row_article_content_builder.js', () => ({ buildRowArticleContent: io.content }));
vi.mock('../dataset_loaded_rows.js', () => ({ captureLoadedDatasetRows: () => null, resolveLoadedDatasetRows: () => null }));
vi.mock('../../navigation/nav_engine/card_article_return_state.js', async () => {
    const { ensureHistoryEntryId } = await import('../../navigation/nav_engine/history_entry_state.js');
    return { captureCardArticleReturn: () => { ensureHistoryEntryId(); return null; },
        getCardArticleReturnToken: () => null, getCardArticleOriginEntry: () => null, invalidateCardArticleReturn: vi.fn() };
});
vi.mock('../../infinite_scroll/infinite_scroll_handler.js', () => ({
    captureInfiniteScrollState: vi.fn(), resumeInfiniteScrollState: vi.fn(), disconnectInfiniteScroll: vi.fn(),
    resetOffset: vi.fn(), updateOffset: vi.fn(),
}));
vi.mock('../../filterbar/text_search/dataset_search_runtime_state.js', () => ({ ongoingSearchResultsStore: {} }));
vi.mock('../../../reusable_components/results_count/results_count_printer.js', () => ({ setResultsCount: vi.fn() }));
vi.mock('../../filterbar/filter_list/column_visibility_handler.js', () => ({ applyColumnVisibility: vi.fn() }));
vi.mock('../../filterbar/filter_list/hidden_filter_state_reconciler.js', () => ({ discardHiddenColumnFilters: () => false }));
vi.mock('../../config_fetcher.js', () => ({ getDefaultDatasetSortSync: () => ({ column: 'id', direction: 'ASC' }) }));
vi.mock('../../route_permission_checker.js', () => ({
    hasRoutePermission: route => route === '/ui/view/article_view', hasDatasetPermission: async () => false,
    primeDatasetPermissions: vi.fn(),
}));
vi.mock('../../navigation/root_redirect_handler.js', () => ({ redirectToRootInSpa: vi.fn() }));
vi.mock('../../lang/translation_handler.js', () => ({ getTranslationForKey: key => key }));
vi.mock('../../dev_tools/function_counter.js', () => ({ count_this_function: vi.fn() }));
vi.mock('../article_view/article_language_editor.js', () => ({ createArticleLanguageEditor: () => null }));
vi.mock('./row_article_section_defaults.js', () => ({ loadRowArticleSectionDefaults: async () => ({}) }));
vi.mock('./card_field_formatter.js', () => ({ parseRoleString: () => ({ baseRoles: [] }),
    cancelEditing: vi.fn(), collectCardUpdates: vi.fn(), disableEditing: vi.fn(), enableEditing: vi.fn(), sendCardUpdates: vi.fn() }));
vi.mock('./row_article_asset_resolver.js', () => ({ resolveRowArticleParentImageRows: () => [] }));
vi.mock('./row_article_load_session.js', () => ({ createRowArticleLoadSession: () => ({}) }));
vi.mock('./row_article_media_hydrator.js', () => ({ createRowArticleMediaHydrator: () => ({
    hydrateRelatedSections: vi.fn(), refreshMediaSections: vi.fn(),
}) }));
vi.mock('./row_article_task_progress_hydrator.js', () => ({ hydrateRowArticleTaskProgressSection: vi.fn() }));
vi.mock('./row_article_ui_handler.js', () => ({ closeRowArticle: vi.fn(), dispatchCardArticleToggle: vi.fn(),
    updateHighlightedCard: vi.fn(), saveScrollBeforeRowArticle: vi.fn() }));
vi.mock('../../user_tools/current_user_profile_fetcher.js', () => ({ fetchCurrentUserProfile: async () => ({ user_id: 1 }) }));
vi.mock('../../endpoints/endpoint_router.js', () => ({ endpoint_router: vi.fn() }));
vi.mock('../../../reusable_components/modal/confirm_modal_builder.js', () => ({ showConfirmModal: vi.fn() }));
vi.mock('../../../reusable_components/notifications/toast_notification_printer.js', () => ({
    showToast: vi.fn(), showSuccessToast: vi.fn(), showAccessDeniedToast: vi.fn(),
}));

import { openDefaultRowPresentation } from '../row_presentation/row_presentation_dispatcher.js';
import { beginRowPresentationRequest } from '../row_presentation/row_presentation_choice.js';
import { datasetAppearanceState } from '../dataset_appearance_state.js';
import { setChosenDatasetView } from '../../state_stores/dataset_view_choice_saver.js';
import { setSelectedDataset } from '../../state_stores/dataset_selection_saver.js';
import { setParams } from '../../navigation/nav_engine/query_params.js';
import { writeHistoryEntry } from '../../navigation/nav_engine/history_entry_state.js';
import * as addressWriter from '../../navigation/nav_engine/dataset_address_writer.js';
import { refreshTableUnified } from '../../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js';
import { openRowArticleView } from './row_article_opener.js';
import { setUnifiedTableState } from '../../state_stores/table_state_store.js';
import { primeDatasetAccessRegistry, clearDatasetAccessRegistry } from '../../navigation/nav_engine/dataset_access_registry.js';

const answer = { columns: ['id', 'title'], types: {}, data: [{ id: 7, title: 'Old row' }], row_count: 1 };
function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}
const article = () => document.querySelector('.active_row_article');
const open = isCurrent => openDefaultRowPresentation({ id: 7 }, 'events', null, { viewKey: 'article_view', isCurrent });

beforeEach(() => {
    vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear(); datasetAppearanceState.clear();
    document.body.innerHTML = '<div id="events_container"><div id="events_article_view_container"><div class="card_view_wrapper"><div class="card_container"><div class="card" data-id="7"></div></div><div class="row_article_placeholder"></div></div></div></div>';
    history.replaceState({}, '', '/events?view=card');
    primeDatasetAccessRegistry({ datasets: [{ table_uid: 7, dataset_name: 'events', names: ['events'], preferred_name: 'events', can_read_rows: true }] });
    setChosenDatasetView('events', 'card'); setSelectedDataset('events'); setParams('events', {});
    io.fetchRows.mockResolvedValue(answer);
    io.render.mockResolvedValue(document.getElementById('events_container'));
    io.fetchArticle.mockImplementation(async ({ rowItem }) => rowItem);
    io.content.mockImplementation(async () => ({ rowArticleContentElement: document.createElement('div') }));
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
});
afterEach(() => { clearDatasetAccessRegistry(); vi.restoreAllMocks(); });

test.each(['caller', 'request', 'address'])('cancellation by %s during the real classic listing fetch renders and opens nothing', async change => {
    const listing = deferred(); let current = true;
    io.fetchRows.mockReturnValueOnce(listing.promise);
    const pending = open(() => current);
    await vi.waitFor(() => expect(io.fetchRows).toHaveBeenCalledOnce());
    document.getElementById('events_container').dataset.newerView = 'retained';
    const newerView = document.body.innerHTML;
    if (change === 'caller') current = false;
    else if (change === 'request') beginRowPresentationRequest('other');
    else writeHistoryEntry('/events?view=table', {});
    listing.resolve(answer);
    await pending;
    expect(io.render).not.toHaveBeenCalled();
    expect(io.fetchArticle).not.toHaveBeenCalled();
    expect(io.content).not.toHaveBeenCalled();
    expect(article()).toBeNull();
    expect(document.body.innerHTML).toBe(newerView);
});

test('cancellation during the downstream article fetch prevents the old row from committing', async () => {
    const row = deferred(); let current = true;
    io.fetchArticle.mockReturnValueOnce(row.promise);
    await open(() => current);
    await vi.waitFor(() => expect(io.fetchArticle).toHaveBeenCalledOnce());
    const guard = io.fetchArticle.mock.calls[0][0].isCurrent;
    expect(guard()).toBe(true);
    current = false;
    expect(guard()).toBe(false);
    row.resolve(answer.data[0]);
    await Promise.resolve(); await Promise.resolve();
    expect(io.content).not.toHaveBeenCalled();
    expect(article()).toBeNull();
});

test('an uncancelled classic handoff survives origin stamping, rebuilds and opens the exact row', async () => {
    await open(() => true);
    await vi.waitFor(() => expect(article()?._row.id).toBe(7));
    expect(io.render).toHaveBeenCalledOnce();
    expect(io.fetchArticle).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ rowItem: answer.data[0] }));
    expect(io.content).toHaveBeenCalledOnce();
    expect(location.pathname).toMatch(/^\/events\/7(?:-|$)/);
});

test('the handoff can settle its own address, while a newer request still vetoes a pending repair', async () => {
    const ticket = beginRowPresentationRequest('events');
    const options = { skipUrlParams: true, isCurrent: ticket, withOwnAddressWrite: ticket.withOwnAddressWrite };
    setChosenDatasetView('events', 'table');
    expect(await refreshTableUnified('events', options)).toBe(answer);
    expect(ticket()).toBe(true);
    expect(location.search).toBe('?view=table');
    await openRowArticleView({ id: 7 }, 'events', null, options);
    await vi.waitFor(() => expect(article()?._row.id).toBe(7));
    expect(ticket()).toBe(true);
    const settledAddress = location.href;
    article().remove();
    setChosenDatasetView('events', 'table');
    setUnifiedTableState('events', { articleView: { collapsed: false, expandedId: null } });
    const settle = addressWriter.updateDatasetAddress;
    let pendingRepair;
    const writer = vi.spyOn(addressWriter, 'updateDatasetAddress').mockImplementationOnce(request => {
        pendingRepair = settle(request);
        beginRowPresentationRequest('newer');
        return pendingRepair;
    });
    await refreshTableUnified('events', options);
    expect(writer).toHaveBeenCalledOnce();
    expect(await pendingRepair).toBe(false);
    expect(ticket()).toBe(false);
    await openRowArticleView({ id: 7 }, 'events', null, options);
    expect(article()).toBeNull();
    expect(location.href).toBe(settledAddress);
});
