// sort_sync_state_helpers.js
// Pure helper functions extracted from sort_sync_state.js for testability.
// Bridges stored selections and query context without DOM access.
// Keeps relevance confined to text searches while ordinary sorting survives clearing.

import { NEWEST_SORT_VALUE } from "./sort_dropdown_builder_helpers.js";

/**
 * Format a column name and direction into a sort selection string.
 * Returns "column:DIRECTION" with the direction uppercased.
 *
 * @param {string} column - Sort column name
 * @param {string} direction - Sort direction ('asc', 'desc', etc.)
 * @returns {string} Formatted sort selection, e.g. "name:ASC"
 */
export function formatSortSelection(column, direction) {
    return `${column}:${String(direction).toUpperCase()}`;
}

/**
 * Resolve a sort selection string from params and unified table state.
 * Checks params first, then state. Returns empty string if neither has sort info.
 *
 * @param {{ sort_column?: string, sort_order?: string }} params - Query params object
 * @param {{ sort?: { column?: string, direction?: string } }} state - Unified table state object
 * @returns {string} Sort selection string (e.g. "name:ASC") or ""
 */
export function resolveSortSelection(params, state) {
    if (params.sort_column && params.sort_order) {
        return formatSortSelection(params.sort_column, params.sort_order);
    }

    if (state.sort?.column && state.sort?.direction) {
        return formatSortSelection(state.sort.column, state.sort.direction);
    }

    if (String(params.search || "").trim()) return "";
    const remembered = state.lastNonSearchSort;
    return remembered?.column && remembered?.direction
        ? formatSortSelection(remembered.column, remembered.direction)
        : NEWEST_SORT_VALUE;
}
