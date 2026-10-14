// hidden_filter_state_reconciler.js
// Removes hidden field selections and suppresses their active chips.
// Connects complete result metadata with persisted filter state and addresses.
// Keeps old URLs usable without applying an invisible generated-name constraint.

import { getUnifiedTableState, setUnifiedTableState } from "../../state_stores/table_state_store.js";
import { getParams, setParams } from "../../navigation/nav_engine/query_params.js";
import { replaceDatasetAddressQuery } from "../../navigation/nav_engine/dataset_address_writer.js";
import { withoutHiddenColumnFilters } from "./filter_column_builder_helpers.js";

/** Hide stale chips during restore; a guarded listing refresh owns persistence. */
export function getVisibleStoredFilters(tableName, filters) {
    try {
        const columns = JSON.parse(localStorage.getItem(`${tableName}_columns`));
        const types = JSON.parse(localStorage.getItem(`${tableName}_dataTypes`));
        return withoutHiddenColumnFilters(tableName, filters, columns, types);
    } catch {
        return filters;
    }
}

/**
 * Reconcile only after a current, successful listing supplies complete metadata.
 * The caller must reload from page one when this returns true; the first reply
 * still described the removed conditions. Replace the address so restoration
 * does not add a history entry. Search, sorting, view and unrelated filters stay.
 */
export function discardHiddenColumnFilters(tableName, columns, dataTypes) {
    const state = getUnifiedTableState(tableName);
    const filters = state.filters || {};
    const params = getParams(tableName);
    const visibleFilters = withoutHiddenColumnFilters(tableName, filters, columns, dataTypes);
    const visibleParams = withoutHiddenColumnFilters(tableName, params, columns, dataTypes);
    if (visibleFilters === filters && visibleParams === params) return false;
    setUnifiedTableState(tableName, { filters: visibleFilters, offset: 0 });
    setParams(tableName, visibleParams);
    replaceDatasetAddressQuery(tableName, visibleParams);
    return true;
}
