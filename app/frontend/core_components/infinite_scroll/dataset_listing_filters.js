// dataset_listing_filters.js
// States the conditions a dataset's listing is asked with.
// Bridges the selected filters and the committed text search with every reader of the listing.
// Exists so the first page a view build loads, each page endless scrolling adds
// and the remembered row list all describe one set of matches, stated once.

import { getParams } from "../navigation/nav_engine/query_params.js";

/**
 * The conditions every page of a dataset's listing is asked with: the selected
 * filters and, when one is committed, the text search. A committed search is
 * one more condition of the listing, so searching a dataset stays browsing it.
 *
 * @param {string} tableName
 * @param {Object} [filters] the selected filters, which are not changed.
 * @returns {Object} the filters to send, with `search` added while a search is committed.
 */
export function getDatasetListingFilters(tableName, filters = {}) {
    const committedSearch = String(getParams(tableName)?.search || "").trim();
    return {
        ...(filters || {}),
        ...(committedSearch ? { search: committedSearch } : {}),
    };
}
