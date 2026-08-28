// table_refresh_unified_helpers.js
// Pure helper functions extracted from table_refresh_unified.js for testability.
// Zero DOM access — all functions are pure input→output.

/**
 * Apply option overrides to a table state object.
 * Returns a new state object with the overrides merged in.
 *
 * @param {{ offset: number, sort: { column: string, direction: string }, filters: Object }} currentState
 * @param {{ offsetOverride?: number, newSortColumn?: string, newSortDirection?: string, newFilters?: Object }} options
 * @returns {{ offset: number, sort: { column: string, direction: string }, filters: Object }}
 */
export function mergeStateWithOptions(currentState, options) {
    const merged = {
        ...currentState,
        sort: { ...currentState.sort },
        filters: { ...currentState.filters },
    };

    if (typeof options.offsetOverride === 'number') {
        merged.offset = options.offsetOverride;
    }
    if (options.newSortColumn) {
        merged.sort.column = options.newSortColumn;
    }
    if (options.newSortDirection) {
        merged.sort.direction = options.newSortDirection;
    }
    if (options.newFilters && typeof options.newFilters === 'object') {
        merged.filters = { ...merged.filters, ...options.newFilters };
    }

    return merged;
}

/**
 * Resolve the sort used when a dataset route is loaded.
 * An explicit URL sort wins; otherwise the configured dataset default is used.
 */
export function resolveRouteSort(parsedSort = {}, defaultSort = {}) {
    if (parsedSort.column && parsedSort.direction) {
        return {
            column: parsedSort.column,
            direction: String(parsedSort.direction).toUpperCase(),
        };
    }

    if (defaultSort.column && defaultSort.direction) {
        return {
            column: defaultSort.column,
            direction: String(defaultSort.direction).toUpperCase(),
        };
    }

    return { column: null, direction: null };
}

/**
 * Compute the next sort state when a column header is clicked.
 * If the same column is clicked, toggles ASC↔DESC.
 * If a different column is clicked, sets it to ASC.
 *
 * @param {{ column: string, direction: string }} currentSort
 * @param {string} clickedColumn
 * @returns {{ column: string, direction: string }}
 */
export function computeNextSortState(currentSort, clickedColumn) {
    if (currentSort.column === clickedColumn) {
        return {
            column: clickedColumn,
            direction: currentSort.direction === 'ASC' ? 'DESC' : 'ASC',
        };
    }
    return { column: clickedColumn, direction: 'ASC' };
}
