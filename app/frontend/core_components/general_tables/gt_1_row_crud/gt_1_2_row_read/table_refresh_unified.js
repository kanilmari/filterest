// table_refresh_unified.js
// Handles the core logic for refreshing table data and updating the UI.
// Bridges data fetching, view generation, infinite scroll, and column visibility into one entry point.
// Exists to provide a single unified refresh function consumed by navigation, filters, and CRUD operations.
import { captureLoadedDatasetRows, resolveLoadedDatasetRows } from "../../../table_views/dataset_loaded_rows.js";
import { getDatasetViewContainerId, resolveDatasetViewSelectionTarget } from "../../../table_views/dataset_view_registry.js";

import { invalidateCardArticleReturn, getCardArticleReturnToken } from "../../../navigation/nav_engine/card_article_return_state.js";
import { fetchDatasetData } from '../../../endpoints/endpoint_data_fetcher.js';
import { generate_table } from '../../../table_views/dataset_view_printer.js';
import { resetOffset, updateOffset, disconnectInfiniteScroll } from '../../../infinite_scroll/infinite_scroll_handler.js';
import { getDatasetListingFilters } from '../../../infinite_scroll/dataset_listing_filters.js';
import { applyColumnVisibility } from '../../../filterbar/filter_list/column_visibility_handler.js';
import { openRowArticleView } from '../../../table_views/card_view/row_article_opener.js';
import { claimFirstListedRow, getArticleStateKey } from '../../../table_views/card_view/first_listed_row.js';
import { setRedirectNotice, clearDatasetSelectionState } from '../../../state_stores/dataset_selection_saver.js';
import { redirectToRootInSpa } from '../../../navigation/root_redirect_handler.js';
import { getParams, parseTableQueryString } from '../../../navigation/nav_engine/query_params.js';
import { getUnifiedTableState, setUnifiedTableState } from '../../../state_stores/table_state_store.js';
import { primeDatasetPermissions } from '../../../route_permission_checker.js';
import { getDefaultDatasetSortSync } from '../../../config_fetcher.js';
import {
    mergeStateWithOptions,
    computeNextSortState,
    resolveRouteSort,
} from './table_refresh_unified_helpers.js';

// Re-export state functions for backward compatibility (17 importers use this path)
export { getUnifiedTableState, setUnifiedTableState };

import { getDatasetQueryAdapter } from '../../../filterbar/dataset_surface_provider/dataset_query_adapter_registry.js';

const refreshGenerations = new Map();

export function invalidateTableRefresh(tableName) {
    refreshGenerations.set(tableName, (refreshGenerations.get(tableName) || 0) + 1);
}

const DATASET_VIEW_PERMISSION_ROUTES = Object.freeze([
    '/api/add-row-multipart',
    '/api/comment-counts',
    '/api/delete-rows',
    '/api/embedding_stream_handler',
    '/api/modify-columns',
    '/api/update-row',
    '/ui/table-view-style-buttons',
]);

/**
 * The committed search's own groups for a view that is about to be rebuilt.
 * The search module is loaded only while a search is committed.
 */
async function getSearchGroupsForViewRebuild(tableName, query) {
    if (!query) return null;
    const searchExecutor = await import("../../../filterbar/text_search/dataset_search_executor.js");
    return searchExecutor.getSearchGroupsForViewRebuild(tableName, { query });
}

/**
 * Pääfunktio, joka huolehtii:
 *   1) sortin & filttereiden kokoamisesta (unified-tila localStoragesta),
 *   2) offsetin käsittelystä,
 *   3) datan hakemisesta fetchDatasetData-funktiolla,
 *   4) taulun rakentamisesta generate_table:lla,
 *   5) offsetin päivityksestä (infinite scroll).
 *
 * Optiot:
 *   - skipUrlParams: (bool) halutaanko lukea URL-parametreja
 *   - offsetOverride: (number) jos halutaan aloittaa jostain muusta offsetista
 *   - newSortColumn, newSortDirection: jos halutaan ylikirjoittaa localStoragen sorttia
 *   - newFilters: jos halutaan ylikirjoittaa localStoragen filtterejä
 */
// refresh_table_unified.js

export async function refreshTableUnified(tableName, options = {}) {
    const preserveCardReturn = options.preserveCardReturn
        && options.preserveCardReturn === getCardArticleReturnToken(tableName)
        ? options.preserveCardReturn : null;
    if (!preserveCardReturn) invalidateCardArticleReturn(tableName);
    const adapter = getDatasetQueryAdapter(tableName);
    if (adapter) return adapter.refresh(options);
    const generation = (refreshGenerations.get(tableName) || 0) + 1;
    refreshGenerations.set(tableName, generation);
    const query = String(getParams(tableName)?.search || "").trim();
    // Forward already changed the active view and parsed the target offset.
    // Only a validated mounted-card return may reuse its still-committed prefix.
    const loadedRowsToken = options.loadedRows || (preserveCardReturn
        ? captureLoadedDatasetRows(tableName, { retainedCardReturn: true }) : null);
    const loadedRows = resolveLoadedDatasetRows(tableName, loadedRowsToken);
    const isCurrent = () => refreshGenerations.get(tableName) === generation
        && String(getParams(tableName)?.search || "").trim() === query
        && (!loadedRows || resolveLoadedDatasetRows(tableName, loadedRowsToken) === loadedRows);
    // console.log('refreshTableUnified tableName and options: ', tableName, options);
    try {
        // 1) Haetaan ensin localStoragen nykyinen unified-tila
        let currentState = getUnifiedTableState(tableName);

        // 2) Haetaanko myös URL-parametrit? (Jos skipUrlParams = false, niin sekoitetaan ne sisään.)
        if (!options.skipUrlParams) {
            const parsed = parseTableQueryString(window.location.search);
            currentState.filters = parsed.filters;
            currentState.sort = parsed.sort?.column && parsed.sort?.direction
                ? resolveRouteSort(parsed.sort)
                : query ? currentState.sort : resolveRouteSort(
                    currentState.sort?.column ? currentState.sort : currentState.lastNonSearchSort,
                    getDefaultDatasetSortSync(tableName)
                );
            currentState.offset = parsed.offset;
        }

        // 3) Ylikirjoita localStoragen tilaa, jos kutsuja laittoi explicit overrideja
        currentState = mergeStateWithOptions(currentState, options);

        // 4) Tallennetaan localStorageen
        // console.log('refresh_table_unified.js: refreshTableUnified kutsuu funktiota setUnifiedTableState arvoilla:', tableName, currentState);
        setUnifiedTableState(tableName, currentState);

        // 4b) Kill old infinite scroll observer + fillScreenInterval to prevent race
        // where fetchMoreData fires during the async gap between resetOffset and generate_table.
        disconnectInfiniteScroll(tableName);

        // 5) Nollataan offset (asetetaan localStorageen offset=0 tälle taululle)
        // console.log('refresh_table_unified.js: refreshTableUnified kutsuu funktiota resetOffset arvoilla:', tableName);
        if (!loadedRows) resetOffset(tableName);

        // 6) Haetaan localStoragesta tuore offset uudelleen
        currentState = getUnifiedTableState(tableName);
        const currentView = resolveDatasetViewSelectionTarget(localStorage.getItem(`${tableName}_view`) || "table");
        const stateKey = getArticleStateKey(currentView);

        // Start the common dataset permission batch before data/render work so
        // the filter bar and card controls do not each trigger their own late check.
        void primeDatasetPermissions(tableName, DATASET_VIEW_PERMISSION_ROUTES);

        // A committed search is browsed like the rest of the dataset: its rows
        // come from the listing below, which carries the search as a condition,
        // and endless scrolling keeps paging them. The search itself owns only
        // its AI and other-dataset groups, which it places after the rebuild.
        const searchGroups = await getSearchGroupsForViewRebuild(tableName, query);
        if (!isCurrent()) return;
        // Changing a filter during a search runs the search again, and that run
        // reloads the listing itself; a rebuild started before it must yield.
        const isRenderCurrent = () => isCurrent() && searchGroups?.isCurrent() !== false;

        // 7) Haetaan data fetchDatasetData-funktiolla (nyt varmasti offset=0, ellei override)
        const result = loadedRows?.result || await fetchDatasetData({
            dataset_name: tableName,
            offset: currentState.offset,
            sort_column: currentState.sort.column,
            sort_order: currentState.sort.direction,
            filters: getDatasetListingFilters(tableName, currentState.filters),
            callerName: 'refreshTableUnified',
            include_card_support: ["card", "article_view", "product_card"].includes(currentView),
            include_map_support: currentView === "map",
            view_key: currentView,
        });
        if (!isRenderCurrent()) return;
        if (!result) {
            console.warn(`fetchDatasetData palautti tyhjän vastauksen taululle: ${tableName}`);
            return;
        }
        const data = result.data || [];
        const columns = result.columns || [];
        const data_types = result.types || {};

        // 8) Seed the next-page offset before rendering.
        // Card view starts infinite scroll during generate_table(), and the
        // observer can wake up immediately on short result sets. Advancing the
        // offset here prevents that first observer tick from re-fetching the
        // same page and appending duplicate cards.
        if (loadedRows) {
            setUnifiedTableState(tableName, { offset: loadedRows.offset });
        } else {
            updateOffset(tableName, data.length);
        }

        // 9) Rakennetaan varsinainen taulu/näkymä
        const _activeContainer = await generate_table(
            tableName,
            columns,
            data,
            data_types,
            result.row_count,
            result.has_geo,
			result.table_meta,
			result.dataset_presentation,
            // A search keeps the row-group facets withdrawn, as it did when it started.
            query ? null : result.row_group_facets,
            ...((preserveCardReturn || loadedRows) ? [{ preserveCardReturn, loadedRows }] : [])
        );
        if (!isRenderCurrent()) return;
        const renderedView = resolveDatasetViewSelectionTarget(localStorage.getItem(`${tableName}_view`) || currentView);
        if (renderedView !== currentView) {
            await refreshTableUnified(tableName, { skipUrlParams: true });
            return;
        }

        // An article waiting for its first row opens the first row just drawn;
        // while a search is committed that is its first match.
        claimFirstListedRow(tableName, currentView, data);
        const stateAfterBuild = getUnifiedTableState(tableName);

        if (stateAfterBuild[stateKey]?.collapsed && stateAfterBuild[stateKey]?.expandedId != null) {
            const expandedId = stateAfterBuild[stateKey].expandedId;
            let rowItem = data.find(r => String(r.id) === String(expandedId));
            let cardElem = document.querySelector(
                `#${getDatasetViewContainerId(currentView, tableName)} .card[data-id='${expandedId}']`
            );

            // If the row is not in the current page of results (deep link),
            // fetch it individually via the API with an id filter
            if (!rowItem) {
                try {
                    const singleResult = await fetchDatasetData({
                        dataset_name: tableName,
                        filters: { id: expandedId },
                        callerName: 'deep_link_big_card',
                        include_card_support: ["card", "article_view", "product_card"].includes(currentView),
                        view_key: currentView,
                    });
                    const singleData = singleResult?.data || singleResult?.rows || [];
                    if (singleData.length > 0) {
                        rowItem = singleData[0];
                    }
                } catch (fetchErr) {
                    console.warn('deep link row fetch failed:', fetchErr);
                }
            }

            if (rowItem && isRenderCurrent()) {
                openRowArticleView(rowItem, tableName, cardElem || null, {
                    isCurrent: () => isRenderCurrent() && resolveDatasetViewSelectionTarget(localStorage.getItem(tableName + "_view") || currentView) === currentView,
                });
            }
        }

        // 10) Sarakenäkyvyys (uusi)
        applyColumnVisibility(tableName);

        // 11) The search's own groups follow the dataset's rows in the rebuilt view.
        if (isRenderCurrent()) await searchGroups?.place({ rowCount: result.row_count });
    } catch (err) {
        if (!isCurrent()) return;
        /* virhe-tulostus ohjeittesi mukaisena */
        console.warn('Error refreshing table:', err);
        const lowerMessage = String(err?.message || err || '').toLowerCase();
        if (lowerMessage.includes('dataset') && lowerMessage.includes('not found')) {
            setRedirectNotice({ datasetName: tableName, reason: 'missing' });
            clearDatasetSelectionState();
            try {
                await redirectToRootInSpa();
            } catch (redirectError) {
                console.warn('SPA root redirect after missing dataset failed, falling back to full navigation:', redirectError);
                window.location.replace('/');
            }
        }
    }
}

/**
 * Pieni apufunktio esimerkkinä, kun klikkaat “sarakkeen järjestä” -nappia:
 *  - se vaihtaa currentState.sort.direction ASC <-> DESC
 *  - tallentaa tilan
 *  - kutsuu refreshTableUnified
 */
export async function toggleSortAndRefresh(tableName, column) {
    const state = getUnifiedTableState(tableName);

    const nextSort = computeNextSortState(state.sort, column);
    state.sort.column = nextSort.column;
    state.sort.direction = nextSort.direction;
    setUnifiedTableState(tableName, state);

    await refreshTableUnified(tableName, { skipUrlParams: true });
}
