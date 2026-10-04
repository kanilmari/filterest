// dataset_view_choice_saver.js
// Keeps the view each dataset shows in this browser tab: read, save and forget.
// Bridges view selection, rendering, history restoration and the page-load
// forgetting with the tab's own session storage (tab_session_storage.js).
// Exists so one tab's view never replaces or erases another tab's (owner decision K143).

import { readTabSessionValue, removeTabSessionValue, writeTabSessionValue } from "./tab_session_storage.js";

/*
 * The choice lives in sessionStorage, which belongs to one browser tab, while
 * every tab of the site shares localStorage. A browser that refuses session
 * storage keeps it in this page's memory instead (tab_session_storage.js).
 * Earlier versions kept the same `<dataset>_view` key, and a
 * `<dataset>_default_view_seen` marker, in localStorage. Nothing reads those
 * copies any more, so they are left for the sign-out reset to clear rather
 * than kept alive by a cleanup path of their own.
 */

const DATASET_VIEW_KEY_SUFFIX = "_view";

function buildDatasetViewKey(datasetName) {
    return `${datasetName}${DATASET_VIEW_KEY_SUFFIX}`;
}

/**
 * Returns the view this tab shows for a dataset, or null when this tab has not
 * chosen or drawn one yet.
 *
 * @param {string} datasetName Internal dataset name.
 * @returns {string|null}
 */
export function getChosenDatasetView(datasetName) {
    return readTabSessionValue(buildDatasetViewKey(datasetName));
}

/**
 * Records the view this tab shows for a dataset. A browser that refuses
 * session storage keeps it in this page's memory.
 *
 * @param {string} datasetName Internal dataset name.
 * @param {string} viewKey View key, already resolved by the caller.
 */
export function setChosenDatasetView(datasetName, viewKey) {
    writeTabSessionValue(buildDatasetViewKey(datasetName), viewKey);
}

/**
 * Forgets the view this tab chose for a dataset, so the dataset's default
 * applies again here. Other tabs keep their own choice.
 *
 * @param {string} datasetName Internal dataset name.
 */
export function forgetChosenDatasetView(datasetName) {
    removeTabSessionValue(buildDatasetViewKey(datasetName));
}
