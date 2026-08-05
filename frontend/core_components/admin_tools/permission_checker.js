// permission_checker.js
// Fetches and evaluates permission-related data for the admin permission editor.
// Bridges endpoint reads for functions, groups, and permission rows with permission-editing UI logic.
// Exists to keep permission data access separate from rendering and form-manipulation code.

import { fetchDatasetData } from "../endpoints/endpoint_data_fetcher.js";
import { mapFunctionFields, mapGroupFields } from "./permission_checker_helpers.js";

const IS_DEV_MODE = document.querySelector('meta[name="app-env"]')?.content === 'dev';

/**
 * Fetches all non-disabled functions from system_functions table.
 * Uses pagination to retrieve all results since getResults endpoint
 * limits results based on results_load_amount config value.
 */
export async function fetch_all_functions() {
    const allFunctions = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
        const result = await fetchDatasetData({
            dataset_name: "system_functions",
            offset: offset,
            filters: {
                disabled: false,
            },
        });

        if (result.data && result.data.length > 0) {
            const filtered = result.data.filter((fn) => !fn.disabled);
            allFunctions.push(...filtered);

            // Check if there are more results to fetch
            const resultsPerLoad = result.resultsPerLoad || 20;
            if (result.data.length < resultsPerLoad) {
                hasMore = false;
            } else {
                offset += resultsPerLoad;
            }
        } else {
            hasMore = false;
        }
    }

    if (IS_DEV_MODE) console.log("kaikki funktiot", allFunctions.length, "kpl");
    return mapFunctionFields(allFunctions);
}

/**
 * Fetches all user groups from system_user_groups table.
 * Uses pagination to retrieve all results.
 */
export async function fetch_user_groups() {
    try {
        const allGroups = [];
        let offset = 0;
        let hasMore = true;

        while (hasMore) {
            const result = await fetchDatasetData({
                dataset_name: "system_user_groups",
                offset: offset,
            });

            if (result.data && result.data.length > 0) {
                allGroups.push(...result.data);

                const resultsPerLoad = result.resultsPerLoad || 20;
                if (result.data.length < resultsPerLoad) {
                    hasMore = false;
                } else {
                    offset += resultsPerLoad;
                }
            } else {
                hasMore = false;
            }
        }

        return mapGroupFields(allGroups);
    } catch (error) {
        throw new Error(`virhe käyttäjäryhmien haussa: ${error.message}`);
    }
}

// Re-exported from permission_checker_helpers.js for backward compatibility.
export { computeMultipleTableState } from "./permission_checker_helpers.js";

export async function fetch_permissions(endpoint_router) {
    return await endpoint_router("datasetPermissions");
}
