// dataset_search_runtime_state.js
// Owns intelligent-search cache identity, filter context, view hosts, and result counters.
// Bridges the streaming executor with row-group metadata and the active dataset view.
// Exists so search-generation safety stays cohesive without overloading the stream parser.

import { getParams } from "../../navigation/nav_engine/query_params.js";
import { getUnifiedTableState } from "../../state_stores/table_state_store.js";
import { getDatasetViewContainerId, resolveDatasetViewSelectionTarget } from "../../table_views/dataset_view_registry.js";
import { setResultsCount, setSearchAiResultsCount } from "../../../reusable_components/results_count/results_count_printer.js";
import { ROW_GROUP_FILTER_KEY } from "../filter_list/row_group_facet_printer.js";
import { getActiveFiltersSnapshot, RESERVED_PARAM_KEYS } from "./dataset_search_state_reader.js";
import {
    countVisibleRows,
    filterRows,
    sortRows,
    initSearchCache,
} from "./dataset_search_executor_helpers.js";

export const ongoingSearchResultsStore = {};

export function isCurrentSearchCache(tableName, expectedCache) {
    return !expectedCache || ongoingSearchResultsStore[tableName] === expectedCache;
}

export function getSearchFilterContext(tableName) {
    const activeFilters = { ...(getActiveFiltersSnapshot(tableName) || {}) };
    for (const key of Object.keys(activeFilters)) {
        if (RESERVED_PARAM_KEYS.has(key.toLowerCase())) delete activeFilters[key];
    }
    const rowGroupSlug = String(activeFilters[ROW_GROUP_FILTER_KEY] ?? "").trim();
    // Row-group membership is server-side metadata, not a field carried by
    // streamed rows. The backend applies it before ranking/LIMIT; the cache
    // must therefore evaluate only ordinary row fields.
    delete activeFilters[ROW_GROUP_FILTER_KEY];
    const signature = JSON.stringify(Object.entries({ ...activeFilters, rowGroupSlug }).sort(([a], [b]) => a.localeCompare(b)));
    return { clientFilters: activeFilters, rowGroupSlug, signature };
}

export function getCurrentSearchView(tableName) {
    return resolveDatasetViewSelectionTarget(localStorage.getItem(`${tableName}_view`) || "table");
}

export function getSearchViewContainer(
    tableName,
    currentView = getCurrentSearchView(tableName)
) {
    return document.getElementById(getDatasetViewContainerId(currentView, tableName));
}

export function getSearchStageContainer(
    tableName,
    currentView = getCurrentSearchView(tableName)
) {
    if (["card", "article_view"].includes(currentView)) {
        return getSearchViewContainer(tableName, currentView)?.querySelector(".card_sidebar_panel") || null;
    }

    return getSearchViewContainer(tableName, currentView);
}

export function getPrimaryCardContainer(tableName) {
    const container = getSearchViewContainer(tableName);
    return (
        container?.querySelector(".card_sidebar_panel > .card_container") ||
        container?.querySelector(".card_container") ||
        null
    );
}

/**
 * Return the one scroll flow that owns every visible search group.
 * Article and card views scroll inside their primary card list; placing
 * notices or supplemental groups beside that list can shrink it out of view.
 */
export function getSearchResultsFlowContainer(
    tableName,
    currentView = getCurrentSearchView(tableName)
) {
    if (["card", "article_view"].includes(currentView)) {
        return getPrimaryCardContainer(tableName);
    }
    return getSearchStageContainer(tableName, currentView);
}

/**
 * Whether a view shows the search's AI group as a group of its own. Other
 * views show only the dataset's own rows, and the counter says the same.
 */
export function showsSearchAiGroup(currentView) {
    return ["table", "card", "article_view"].includes(currentView);
}

export function getSearchAiHostId(
    tableName,
    currentView = getCurrentSearchView(tableName)
) {
    return currentView === "table"
        ? `${tableName}_search_ai_table`
        : `${tableName}_search_ai_cards`;
}

export function removeSearchNotice(tableName, langKey) {
    const currentView = getCurrentSearchView(tableName);
    const stageContainer = getSearchStageContainer(tableName, currentView);
    if (!stageContainer) return;

    const existing = stageContainer.querySelectorAll(
        `.search-stage-notice[data-lang-key="${langKey}"]`
    );
    existing.forEach((element) => {
        const row = element.closest("tr");
        if (row) {
            row.remove();
        } else {
            element.remove();
        }
    });
}

/**
 * Remember how many rows of this dataset the search actually matches.
 * The number comes from the dataset's own listing, which counts every match
 * rather than the handful of rows that happen to be loaded, so the counter can
 * keep telling the truth while the reader scrolls further into the results.
 */
export function setSearchDatasetMatchCount(cache, rowCount) {
    if (!cache) return;
    cache.datasetMatchCount = Number.isFinite(rowCount) ? rowCount : null;
}

export function getVisibleSearchCounts(
    tableName,
    cache = ongoingSearchResultsStore[tableName]
) {
    const searchCache = cache || initSearchCache();
    return {
        // The listing's own count when it is known; otherwise the rows the
        // search itself is holding, which is all there is to report yet.
        textCount: Number.isFinite(searchCache.datasetMatchCount)
            ? searchCache.datasetMatchCount
            : countVisibleRows(
                searchCache.data,
                searchCache.filters,
                tableName,
                searchCache.types
            ),
        // Only a view that shows the AI group counts its rows.
        aiCount: showsSearchAiGroup(getCurrentSearchView(tableName))
            ? countVisibleRows(
                searchCache.aiData,
                searchCache.filters,
                tableName,
                searchCache.types
            )
            : 0,
    };
}

export function syncSearchResultsCount(
    tableName,
    cache = ongoingSearchResultsStore[tableName]
) {
    const { textCount, aiCount } = getVisibleSearchCounts(tableName, cache);
    setSearchAiResultsCount(tableName, aiCount);
    setResultsCount(tableName, textCount);
}

/** Withdraw the search's own part of the counter when the search ends. */
export function clearSearchResultsCount(tableName) {
    setSearchAiResultsCount(tableName, null);
}

/**
 * Resolve presentation filters without changing the selected filters or URL.
 * Only the AI result group is filtered in the browser; the dataset's own rows
 * arrive from a listing that already applied the selected filters.
 */
function syncSearchPresentationFilters(tableName, cache) {
    const context = getSearchFilterContext(tableName);
    const serverScopeMatches = cache.serverFiltersApplied && cache.filterSignature === context.signature;
    cache.filters = serverScopeMatches ? {} : context.clientFilters;
    return cache.filters;
}

/** Sort visible rows from their original relevance order using the current selection. */
export function getSearchPresentationRows(tableName, cache, rows) {
    syncSearchPresentationFilters(tableName, cache);
    const params = getParams(tableName);
    const state = getUnifiedTableState(tableName);
    return sortRows(filterRows(rows, cache.filters, tableName, cache.types),
        params.sort_column || state.sort?.column,
        params.sort_order || state.sort?.direction, cache.types);
}
