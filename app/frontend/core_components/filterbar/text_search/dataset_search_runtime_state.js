// dataset_search_runtime_state.js
// Owns intelligent-search cache identity, filter context, view hosts, and result counters.
// Bridges the streaming executor with row-group metadata and the active dataset view.
// Exists so search-generation safety stays cohesive without overloading the stream parser.

import { getParams } from "../../navigation/nav_engine/query_params.js";
import { getUnifiedTableState } from "../../state_stores/table_state_store.js";
import { getDatasetViewContainerId, resolveDatasetViewSelectionTarget } from "../../table_views/dataset_view_registry.js";
import { setResultsCount } from "../../../reusable_components/results_count/results_count_printer.js";
import { ROW_GROUP_FILTER_KEY } from "../filter_list/row_group_facet_printer.js";
import { getActiveFiltersSnapshot, RESERVED_PARAM_KEYS } from "./dataset_search_state_reader.js";
import {
    countVisibleRows,
    filterRows,
    sortRows,
    initSearchCache,
} from "./dataset_search_executor_helpers.js";

const SEARCH_BREAKDOWN_MODE = "search-breakdown";

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

export function getSearchAiHostId(
    tableName,
    currentView = getCurrentSearchView(tableName)
) {
    if (["card", "article_view"].includes(currentView)) {
        return `${tableName}_search_ai_cards`;
    }
    if (currentView === "table") {
        return `${tableName}_search_ai_table`;
    }
    return `${tableName}_search_ai_host`;
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

export function getVisibleSearchCounts(
    tableName,
    cache = ongoingSearchResultsStore[tableName]
) {
    const searchCache = cache || initSearchCache();
    return {
        textCount: countVisibleRows(
            searchCache.data,
            searchCache.filters,
            tableName,
            searchCache.types
        ),
        aiCount: countVisibleRows(
            searchCache.aiData,
            searchCache.filters,
            tableName,
            searchCache.types
        ),
    };
}

function buildSearchResultsCountPayload(
    tableName,
    cache = ongoingSearchResultsStore[tableName]
) {
    return {
        mode: SEARCH_BREAKDOWN_MODE,
        ...getVisibleSearchCounts(tableName, cache),
    };
}

export function syncSearchResultsCount(
    tableName,
    cache = ongoingSearchResultsStore[tableName]
) {
    setResultsCount(tableName, buildSearchResultsCountPayload(tableName, cache));
}

/** Resolve presentation filters without changing the selected filters or URL. */
export function syncSearchPresentationFilters(tableName, cache) {
    const context = getSearchFilterContext(tableName);
    if (cache.filterSignature !== context.signature) cache.fallbackWithoutFilters = false;
    const serverScopeMatches = cache.serverFiltersApplied && cache.filterSignature === context.signature;
    cache.filters = cache.fallbackWithoutFilters || serverScopeMatches ? {} : context.clientFilters;
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
