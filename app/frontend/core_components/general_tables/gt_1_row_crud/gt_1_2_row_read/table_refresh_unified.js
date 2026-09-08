// table_refresh_unified.js
// Handles the core logic for refreshing table data and updating the UI.
// Bridges data fetching, view generation, infinite scroll, and column visibility into one entry point.
// Exists to provide a single unified refresh function consumed by navigation, filters, and CRUD operations.
import { fetchDatasetData } from '../../../endpoints/endpoint_data_fetcher.js';
import { generate_table } from '../../../table_views/dataset_view_printer.js';
import { resetOffset, updateOffset, disconnectInfiniteScroll } from '../../../infinite_scroll/infinite_scroll_handler.js';
import { applyColumnVisibility } from '../../../filterbar/filter_list/column_visibility_handler.js';
import { openRowArticleView } from '../../../table_views/card_view/row_article_opener.js';
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

import { resolveDatasetViewSelectionTarget } from "../../../table_views/dataset_view_registry.js";

const refreshGenerations = new Map();

const DATASET_VIEW_PERMISSION_ROUTES = Object.freeze([
    '/api/add-row-multipart',
    '/api/comment-counts',
    '/api/delete-rows',
    '/api/embedding_stream_handler',
    '/api/modify-columns',
    '/api/update-row',
    '/ui/table-view-style-buttons',
]);

async function getActiveCachedSearchRenderResult(tableName) {
    const committedSearchTerm = String(getParams(tableName)?.search || "").trim();
    if (!committedSearchTerm) {
        return null;
    }

    const {
        getCachedSearchResultForRender,
    } = await import("../../../filterbar/text_search/dataset_search_executor.js");
    return getCachedSearchResultForRender(tableName, { query: committedSearchTerm });
}

function getFirstRenderableRowId(rows = []) {
    const firstRow = rows.find((row) => row?.id != null) || rows[0] || null;
    return firstRow?.id ?? null;
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
    const generation = (refreshGenerations.get(tableName) || 0) + 1;
    refreshGenerations.set(tableName, generation);
    const query = String(getParams(tableName)?.search || "").trim();
    const isCurrent = () => refreshGenerations.get(tableName) === generation
        && String(getParams(tableName)?.search || "").trim() === query;
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
        resetOffset(tableName);

        // 6) Haetaan localStoragesta tuore offset uudelleen
        currentState = getUnifiedTableState(tableName);
        const currentView = resolveDatasetViewSelectionTarget(localStorage.getItem(`${tableName}_view`) || "table");
        const stateKey = currentView === "article_view" ? "articleView" : "cardView";

        // Start the common dataset permission batch before data/render work so
        // the filter bar and card controls do not each trigger their own late check.
        void primeDatasetPermissions(tableName, DATASET_VIEW_PERMISSION_ROUTES);

        let cachedSearchRenderResult = await getActiveCachedSearchRenderResult(tableName);
        if (!isCurrent()) return;

        // 7) Haetaan data fetchDatasetData-funktiolla (nyt varmasti offset=0, ellei override)
        const result = await fetchDatasetData({
            dataset_name: tableName,
            offset: currentState.offset,
            sort_column: currentState.sort.column,
            sort_order: currentState.sort.direction,
            filters: currentState.filters,
            callerName: 'refreshTableUnified',
            include_card_support: ["card", "article_view", "product_card"].includes(currentView),
            include_map_support: currentView === "map",
            view_key: currentView,
        });
        if (!isCurrent()) return;
        if (query) cachedSearchRenderResult = await getActiveCachedSearchRenderResult(tableName);
        if (!isCurrent()) return;
        if (!result) {
            console.warn(`fetchDatasetData palautti tyhjän vastauksen taululle: ${tableName}`);
            return;
        }
        const data = result.data || [];
        const columns = result.columns || [];
        const data_types = result.types || {};
        const hasCachedSearchRenderResult = Boolean(query);
        // Metadata may come from the ordinary list, but its rows are never
        // substitutes while the current text-search response is still pending.
        if (query && !cachedSearchRenderResult) cachedSearchRenderResult = { data: [], row_count: 0, complete: false };
        const renderData = hasCachedSearchRenderResult
            ? cachedSearchRenderResult.data || []
            : data;
        const renderColumns = columns.length
            ? columns
            : cachedSearchRenderResult?.columns || [];
        const renderDataTypes = hasCachedSearchRenderResult
            ? { ...(cachedSearchRenderResult.types || {}), ...data_types }
            : data_types;
        const renderRowCount = hasCachedSearchRenderResult
            ? cachedSearchRenderResult.row_count
            : result.row_count;

        // 8) Seed the next-page offset before rendering.
        // Card view starts infinite scroll during generate_table(), and the
        // observer can wake up immediately on short result sets. Advancing the
        // offset here prevents that first observer tick from re-fetching the
        // same page and appending duplicate cards.
        if (!hasCachedSearchRenderResult) {
            updateOffset(tableName, data.length);
        }

        // 9) Rakennetaan varsinainen taulu/näkymä
        const _activeContainer = await generate_table(
            tableName,
            renderColumns,
            renderData,
            renderDataTypes,
            renderRowCount,
            result.has_geo,
			result.table_meta,
			result.dataset_presentation,
            hasCachedSearchRenderResult ? null : result.row_group_facets
        );
        if (!isCurrent() || cachedSearchRenderResult?.isCurrent?.() === false) return;
        if (hasCachedSearchRenderResult) {
            disconnectInfiniteScroll(tableName);
        }
        const renderedView = resolveDatasetViewSelectionTarget(localStorage.getItem(`${tableName}_view`) || currentView);
        if (renderedView !== currentView) {
            await refreshTableUnified(tableName, { skipUrlParams: true });
            return;
        }

        let stateAfterBuild = getUnifiedTableState(tableName);
        const cardStateAfterBuild = stateAfterBuild[stateKey] || {};
        const shouldAutoOpenFirstResult =
            cardStateAfterBuild.collapsed === true
            && cardStateAfterBuild.expandedId == null
            && (
                cardStateAfterBuild.pendingAutoOpenFirstRenderedResult === true
                || (cardStateAfterBuild.pendingAutoOpenFirstSearchResult === true
                    && cachedSearchRenderResult?.complete === true)
            );
        if (shouldAutoOpenFirstResult) {
            const firstRowId = getFirstRenderableRowId(renderData);
            if (firstRowId != null) {
                setUnifiedTableState(tableName, {
                    [stateKey]: {
                        ...cardStateAfterBuild,
                        expandedId: firstRowId,
                        pendingAutoOpenFirstRenderedResult: false,
                        pendingAutoOpenFirstSearchResult: false,
                    },
                });
                stateAfterBuild = getUnifiedTableState(tableName);
            }
        }

        if (stateAfterBuild[stateKey]?.collapsed && stateAfterBuild[stateKey]?.expandedId != null) {
            const expandedId = stateAfterBuild[stateKey].expandedId;
            let rowItem = renderData.find(r => String(r.id) === String(expandedId));
            let cardElem = document.querySelector(
                `#${tableName}_${currentView}_view_container .card[data-id='${expandedId}']`
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

            if (rowItem && isCurrent()) {
                openRowArticleView(rowItem, tableName, cardElem || null, {
                    isCurrent: () => isCurrent() && cachedSearchRenderResult?.isCurrent?.() !== false && resolveDatasetViewSelectionTarget(localStorage.getItem(tableName + "_view") || currentView) === currentView,
                });
            }
        }

        // 10) Sarakenäkyvyys (uusi)
        applyColumnVisibility(tableName);
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
