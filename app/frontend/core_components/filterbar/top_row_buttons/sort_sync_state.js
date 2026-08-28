// sort_sync_state.js
// Stores and broadcasts shared dataset sort selection across duplicated filterbar controls.
// Bridges unified table state and query params with multiple sort dropdown UIs.
// Exists to keep inline-hero and sidebar sort controls synchronized without duplicating state logic.

import { getParams } from "../../navigation/nav_engine/query_params.js";
import { getUnifiedTableState } from "../../state_stores/table_state_store.js";
import { resolveSortSelection } from "./sort_sync_state_helpers.js";

const DATASET_SORT_SYNC_EVENT = "dataset-sort-sync-changed";

export function getDatasetSortSelection(tableName) {
    return resolveSortSelection(getParams(tableName), getUnifiedTableState(tableName));
}

export function emitDatasetSortSelection(tableName, value = null) {
    const normalizedValue =
        typeof value === "string" ? value : getDatasetSortSelection(tableName);

    window.dispatchEvent(
        new CustomEvent(DATASET_SORT_SYNC_EVENT, {
            detail: {
                dataset: tableName,
                value: normalizedValue,
            },
        })
    );

    return normalizedValue;
}

export function subscribeDatasetSortSelection(tableName, callback) {
    if (typeof callback !== "function") {
        return () => {};
    }

    const notify = (value = getDatasetSortSelection(tableName)) => {
        try {
            callback(value);
        } catch (err) {
            console.warn("dataset sort sync subscriber error", err);
        }
    };

    const onSortSync = (event) => {
        if (event.detail?.dataset !== tableName) return;
        notify(
            typeof event.detail.value === "string"
                ? event.detail.value
                : getDatasetSortSelection(tableName)
        );
    };

    const onQueryParamsChanged = (event) => {
        if (event.detail?.dataset !== tableName) return;
        notify();
    };

    window.addEventListener(DATASET_SORT_SYNC_EVENT, onSortSync);
    window.addEventListener(
        "dataset-query-params-changed",
        onQueryParamsChanged
    );

    notify();

    return () => {
        window.removeEventListener(DATASET_SORT_SYNC_EVENT, onSortSync);
        window.removeEventListener(
            "dataset-query-params-changed",
            onQueryParamsChanged
        );
    };
}
