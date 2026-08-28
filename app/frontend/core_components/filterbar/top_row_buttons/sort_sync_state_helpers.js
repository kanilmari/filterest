// sort_sync_state_helpers.js
// Pure helper functions extracted from sort_sync_state.js for testability.
// Zero DOM access — all functions are pure input→output.

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

    return "";
}
