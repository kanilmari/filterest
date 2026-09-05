// row_api_fetcher.js
// Fetches row-creation metadata needed before rendering add-row forms.
// Bridges row-creation UI helpers with endpoint-router calls for column and dataset metadata.
// Exists to isolate row-creation API reads from form rendering and submission logic.

import { endpoint_router } from "../../../endpoints/endpoint_router.js";
import { fetchFilterOptions } from "../../../endpoints/endpoint_data_fetcher.js";

var debug = false;

// Re-export for backward compatibility; canonical location is table_specs_store.js
export { getDatasetNameByUID } from "../../../state_stores/table_specs_reader.js";

export async function fetchColumnsInfo(table_uid) {
    try {
        const columns_info = await endpoint_router('getColumns', {
            url_params: `?table_uid=${table_uid}`,
        });
        return columns_info;
    } catch (error) {
        console.warn(
            `Error fetching column information for table ${table_uid}:`,
            error
        );
        return null;
    }
}

export async function fetchOneToManyRelations(tableUid) {
    try {
        const data = await endpoint_router('getOneToMany', {
            url_params: `?table_uid=${tableUid}`,
        });
        return data;
    } catch (error) {
        if (debug) {
            console.debug(
                `virhe haettaessa 1->m-suhteita taululle ${tableUid}:`,
                error
            );
        }
        return [];
    }
}

export async function fetchManyToManyInfos(table_uid) {
    try {
        const data = await endpoint_router('getManyToMany', {
            url_params: `?table_uid=${table_uid}`,
        });
        return data;
    } catch (error) {
        if (debug) {
            console.debug(
                `virhe haettaessa monesta-moneen-liitoksia taululle ${table_uid}:`,
                error
            );
        }
        return [];
    }
}

export async function fetchReferencedData(datasetName) {
    try {
        const data = await endpoint_router('referencedData', {
            url_params: `?dataset=${datasetName}`,
        });
        if (!Array.isArray(data)) {
            console.warn(
                `fetchReferencedData: odotettiin taulukkoa, mutta saatiin:`,
                data
            );
            return [];
        }
        return data;
    } catch (error) {
        console.warn(
            `virhe haettaessa dataa taulusta ${datasetName}:`,
            error
        );
        return [];
    }
}

// Add-row relation pickers share the same permission- and row-policy-aware
// option endpoint as FK filters. This prevents a relation control from listing
// rows that the current actor cannot otherwise read.
export async function fetchLinkableRows(datasetName, valueColumn = "id", {
    search = "",
    limit = 100,
} = {}) {
    try {
        const data = await fetchFilterOptions({
            dataset_name: datasetName,
            value_column: valueColumn,
            search,
            limit,
        });
        return Array.isArray(data) ? data : [];
    } catch (error) {
        console.warn(`virhe haettaessa linkitettäviä rivejä taulusta ${datasetName}:`, error);
        return [];
    }
}
