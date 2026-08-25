// dataset_search_runtime_state.js
// Owns intelligent-search cache identity, filter context, view hosts, and result counters.
// Bridges the streaming executor with row-group metadata and the active dataset view.
// Exists so search-generation safety stays cohesive without overloading the stream parser.

import { setResultsCount } from "../../../reusable_components/results_count/results_count_printer.js";
import { ROW_GROUP_FILTER_KEY } from "../filter_list/row_group_facet_printer.js";
import { getActiveFiltersSnapshot } from "./dataset_search_state_reader.js";
import {
    countVisibleRows,
    initSearchCache,
} from "./dataset_search_executor_helpers.js";

const SEARCH_BREAKDOWN_MODE = "search-breakdown";

export const ongoingSearchResultsStore = {};

export function isCurrentSearchCache(tableName, expectedCache) {
    return !expectedCache || ongoingSearchResultsStore[tableName] === expectedCache;
}

export function getSearchFilterContext(tableName) {
    const activeFilters = { ...(getActiveFiltersSnapshot(tableName) || {}) };
    const rowGroupSlug = String(activeFilters[ROW_GROUP_FILTER_KEY] ?? "").trim();
    // Row-group membership is server-side metadata, not a field carried by
    // streamed rows. The backend applies it before ranking/LIMIT; the cache
    // must therefore evaluate only ordinary row fields.
    delete activeFilters[ROW_GROUP_FILTER_KEY];
    return { clientFilters: activeFilters, rowGroupSlug };
}

export function getCurrentSearchView(tableName) {
    return localStorage.getItem(`${tableName}_view`) || "table";
}

export function getSearchViewContainer(
    tableName,
    currentView = getCurrentSearchView(tableName)
) {
    return document.getElementById(`${tableName}_${currentView}_view_container`);
}

export function getSearchStageContainer(
    tableName,
    currentView = getCurrentSearchView(tableName)
) {
    if (currentView === "card") {
        return document.querySelector(
            `#${tableName}_card_view_container .card_sidebar_panel`
        );
    }

    return getSearchViewContainer(tableName, currentView);
}

export function getPrimaryCardContainer(tableName) {
    return (
        document.querySelector(
            `#${tableName}_card_view_container .card_sidebar_panel > .card_container`
        ) ||
        document.querySelector(`#${tableName}_card_view_container .card_container`)
    );
}

export function getSearchAiHostId(
    tableName,
    currentView = getCurrentSearchView(tableName)
) {
    if (currentView === "card") {
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
