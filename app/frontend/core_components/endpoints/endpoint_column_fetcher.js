// endpoint_column_fetcher.js
// Fetches dataset column metadata from the backend.
// Bridges frontend table/form code with the endpoint router's dataset-column endpoint.
// Exists to centralize column-metadata reads used across views and row forms.

import { endpoint_router } from './endpoint_router.js';

/**
 * Fetches column metadata for a dataset from /api/dataset-columns/:dataset_name.
 * @param {string} dataset_name - The dataset identifier to fetch columns for.
 * @returns {Promise<Array>} Array of column metadata objects.
 */
export async function fetch_columns_for_table(dataset_name) {
    return await endpoint_router('datasetColumns', { url_params: dataset_name });
}
