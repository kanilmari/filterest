// dataset_search_clearer.js
// Clears one committed dataset text search without resetting adjacent query state.
// Bridges URL/search cache state with synchronized inputs and the normal table refresh path.
// Exists so search chips and search-field clear buttons share one narrow state transition.

import {
    DATASET_PREFIX,
    getParams,
    setParams,
    updateURL,
} from "../../navigation/nav_engine/query_params.js";
import { isDatasetRowPath } from "../../navigation/nav_engine/history_navigation_handler_helpers.js";
import { getUnifiedTableState, setUnifiedTableState, refreshTableUnified } from "../../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js";
import { datasetSearchState } from "./dataset_search_state_reader.js";
import { ongoingSearchResults } from "./dataset_search_executor.js";
import { clearSearchResultsCount, getSearchAiHostId, showsSearchAiGroup } from "./dataset_search_runtime_state.js";
import { getDatasetViewContainerId, RENDERABLE_DATASET_VIEW_DEFINITIONS } from "../../table_views/dataset_view_registry.js";

import { resolveSortSelection } from "../top_row_buttons/sort_sync_state_helpers.js";

export const DATASET_COMMITTED_SEARCH_CHANGED_EVENT =
    "dataset-committed-search-changed";

function getSearchClearingUrlOptions(tableName) {
    if (!isDatasetRowPath(window.location.pathname, DATASET_PREFIX, tableName)) {
        return {};
    }
    return {
        pathOverride: window.location.pathname,
        state: history.state || {},
    };
}

function removeDatasetSearchArtifacts(tableName) {
    for (const { viewKey } of RENDERABLE_DATASET_VIEW_DEFINITIONS) {
        if (!showsSearchAiGroup(viewKey)) continue;
        const viewContainer = document.getElementById(
            getDatasetViewContainerId(viewKey, tableName)
        );
        if (!viewContainer) continue;
        viewContainer
            .querySelectorAll(`#${getSearchAiHostId(tableName, viewKey)}, .search-stage-notice`)
            .forEach((element) => element.remove());
    }
}

/**
 * Report whether a dataset currently has a committed URL-backed text search.
 * Between icon visibility checks and the canonical per-dataset query parameters.
 * Exists so an uncommitted draft never triggers a destructive-looking no-op.
 */
export function hasCommittedDatasetSearch(tableName) {
    return String(getParams(tableName).search || "").trim() !== "";
}

/**
 * Notify every mounted search surface after the committed query changes.
 * Between commit/clear commands and duplicated clear-button accessibility state.
 * Exists because draft synchronization alone cannot distinguish typing from commit.
 */
export function notifyCommittedDatasetSearchChanged(tableName) {
    window.dispatchEvent(
        new CustomEvent(DATASET_COMMITTED_SEARCH_CHANGED_EVENT, {
            detail: {
                dataset: tableName,
                committed: hasCommittedDatasetSearch(tableName),
            },
        })
    );
}

/**
 * Clear only a committed text search and restore ordinary dataset rendering.
 * Between URL/query state, search runtime artifacts, and the synchronized inputs.
 * Exists to preserve sort, field filters, view, and row-article route identity.
 *
 * @returns {boolean} true only when committed search state actually changed.
 */
export function clearCommittedDatasetSearch(tableName) {
    const params = getParams(tableName);
    if (String(params.search || "").trim() === "") {
        return false;
    }

    delete params.search;
    const [column, direction] = resolveSortSelection(params, getUnifiedTableState(tableName)).split(":");
    params.sort_column = column;
    params.sort_order = direction;
    setUnifiedTableState(tableName, { sort: { column, direction } });
    setParams(tableName, params);
    updateURL(
        tableName,
        params,
        undefined,
        getSearchClearingUrlOptions(tableName)
    );

    datasetSearchState.set(tableName, "", "clear-committed-search");
    // An explicit empty draft suppresses the older history fallback on reload
    // while preserving that history for ArrowUp/ArrowDown recall.
    localStorage.setItem(`int_search_draft_${tableName}`, "");
    ongoingSearchResults[tableName] = null;
    // Without the search there is no AI group, so the counter goes back to the
    // dataset's own single number instead of keeping a stale second part.
    clearSearchResultsCount(tableName);
    removeDatasetSearchArtifacts(tableName);
    notifyCommittedDatasetSearchChanged(tableName);
    void refreshTableUnified(tableName, { skipUrlParams: true });
    return true;
}
