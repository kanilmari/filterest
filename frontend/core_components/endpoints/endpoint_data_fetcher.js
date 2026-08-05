// endpoint_data_fetcher.js
// Fetches dataset row data with pagination, sorting, filtering, and language context.
// Bridges higher-level table/card views with endpoint-router data retrieval calls.
// Exists to centralize dataset data-fetch semantics instead of duplicating query assembly in views.

import { endpoint_router } from './endpoint_router.js';
import { getLanguageWithBrowserFallback } from '../state_stores/lang_preference_reader.js';
import { buildDatasetQueryParams } from './endpoint_data_fetcher_helpers.js';

/**
 * fetchFilterOptions — loads distinct label/value pairs for one dataset column.
 * Bridges filterbar foreign-key dropdowns and the routed filter-options endpoint.
 * Exists so filter option lookups stay inside endpoint_router instead of direct fetch().
 */
export async function fetchFilterOptions({
    dataset_name,
    value_column = 'id',
} = {}) {
    if (!dataset_name) {
        throw new Error('fetchFilterOptions requires dataset_name');
    }

    const params = new URLSearchParams({
        dataset: dataset_name,
        value_column,
    });

    return await endpoint_router('getFilterOptions', {
        url_params: `?${params.toString()}`,
    });
}

/**
 * Version 2.0
 *
 * @param {Object} options
 * @param {string} options.dataset_name  - dataset name (maps to ?dataset=...)
 * @param {number} [options.offset=0]  - offset-parametri (mapataan ?offset=...)
 * @param {string} [options.sort_column=null] - lajittelusarakkeen nimi (mapataan ?sort_column=...)
 * @param {string} [options.sort_order=null]  - ASC tai DESC (mapataan ?sort_order=...)
 * @param {Object} [options.filters={}] - muut filtteröintiparametrit (avain-arvo)
 * @param {string} [options.callerName=''] - (valinnainen) kutsujafunktion nimi lokitusta varten
 * @param {number|null} [options.row_count=null] - edellisestä vastauksesta saatu rivimäärä (ohittaa COUNT(*) backendissä)
 * @param {boolean} [options.include_card_support=false] - lisää piilotetut korttikentät vastaukseen
 * @param {boolean} [options.include_map_support=false] - lisää piilotetut karttageometriat vastaukseen
 *
 * @returns {Promise<Object>} Palauttaa JSON-vastauksen, muotoa:
 *   {
 *     "columns": [...],
 *     "data": [...],
 *     "types": {...},
 *     "resultsPerLoad": number,
 *     "row_count": number,
 *     "has_geo": boolean,
 *     "geom_columns": string[],
 *     "geom_sources": string[]
 *   }
 */
export async function fetchDatasetData({
    dataset_name,
    offset = 0,
    sort_column = null,
    sort_order = null,
    filters = {},
    callerName: _callerName = '',
    row_count = null,
    include_card_support = false,
    include_map_support = false,
}) {
    const chosenLang = getLanguageWithBrowserFallback();
    const url_params = buildDatasetQueryParams({
        dataset_name,
        offset,
        lang: chosenLang || null,
        sort_column,
        sort_order,
        filters,
        row_count,
        include_card_support,
        include_map_support,
    });
    return await endpoint_router('getResults', { url_params });
}
