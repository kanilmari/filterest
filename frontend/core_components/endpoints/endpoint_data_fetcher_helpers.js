// endpoint_data_fetcher_helpers.js
// Pure helper functions extracted from endpoint_data_fetcher.js for testability.
// Zero DOM access — all functions are pure input→output.

/**
 * Validate and normalize a sort order string.
 * Accepts 'asc'/'desc' in any case, returns uppercase.
 * Returns 'ASC' as fallback for invalid values.
 *
 * @param {string} sortOrder - The sort order to validate
 * @returns {string} 'ASC' or 'DESC'
 */
export function validateSortOrder(sortOrder) {
    const upper = String(sortOrder).toUpperCase();
    return (upper === 'ASC' || upper === 'DESC') ? upper : 'ASC';
}

/**
 * Determine whether row_count should be included in query params.
 * Row count is sent to the backend on scroll batches (offset > 0)
 * to skip redundant COUNT(*) queries.
 *
 * @param {number|null} rowCount - Previously received row count, or null
 * @param {number} offset - Current pagination offset
 * @returns {boolean}
 */
export function shouldIncludeRowCount(rowCount, offset) {
    return rowCount !== null && offset > 0;
}

/**
 * Build URLSearchParams string for a dataset data fetch.
 * Pure version — language is passed in rather than read from state.
 *
 * @param {Object} options
 * @param {string} options.dataset_name - Dataset name (?dataset=...)
 * @param {number} [options.offset=0] - Pagination offset
 * @param {string|null} [options.lang=null] - Language code, or null to omit
 * @param {string|null} [options.sort_column=null] - Sort column name
 * @param {string|null} [options.sort_order=null] - 'ASC' or 'DESC'
 * @param {Object} [options.filters={}] - Additional filter key-value pairs
 * @param {number|null} [options.row_count=null] - Cached row count from previous response
 * @param {boolean} [options.include_card_support=false] - Include hidden card support fields
 * @param {boolean} [options.include_map_support=false] - Include hidden map geometry fields
 * @returns {string} Query string including leading '?'
 */
export function buildDatasetQueryParams({
    dataset_name,
    offset = 0,
    lang = null,
    sort_column = null,
    sort_order = null,
    filters = {},
    row_count = null,
    include_card_support = false,
    include_map_support = false,
}) {
    const params = new URLSearchParams();

    params.append('dataset', dataset_name);
    params.append('offset', offset);

    if (lang) {
        params.append('lang', lang);
    }

    if (sort_column) {
        params.append('sort_column', sort_column);
    }
    if (sort_order) {
        params.append('sort_order', validateSortOrder(sort_order));
    }

    for (const [key, val] of Object.entries(filters)) {
        if (val !== null && val !== undefined && val !== '') {
            params.append(key, val);
        }
    }

    if (shouldIncludeRowCount(row_count, offset)) {
        params.append('row_count', row_count);
    }

    if (include_card_support === true) {
        params.append('include_card_support', '1');
    }

    if (include_map_support === true) {
        params.append('include_map_support', '1');
    }

    return '?' + params.toString();
}
