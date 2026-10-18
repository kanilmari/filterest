// dataset_search_permission_reader.js
// Reads the existing AI route permission for every dataset-search entry point.
// Connects primary and supplemental search with the browser's route-right cache.
// Keeps paid search separate from the readable-dataset catalogue and text listing.
import { hasCachedRouteRights } from "../../permission_cache_reader.js";

export function hasDatasetAiSearchPermission() {
    return hasCachedRouteRights("/api/get-intelligent-results");
}
