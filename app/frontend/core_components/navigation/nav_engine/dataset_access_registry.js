// dataset_access_registry.js
// Tracks the latest dataset-read access snapshot returned by the datasets endpoint.
// Bridges fetchContentTables responses and later navigation permission checks.
// Exists to let dataset navigation trust the already-filtered dataset list instead of re-checking /api/get-results one table at a time.

const readableDatasetNames = new Set();
let hasSnapshot = false;
let refreshGeneration = 0;
const acceptedResponses = new WeakMap();
const listeners = new Set();

function notifySnapshotChanged() {
    for (const listener of listeners) listener();
}

/** Starts a metadata refresh; older responses may no longer grant access. */
export function beginDatasetAccessRefresh() {
    clearDatasetAccessRegistry();
    return refreshGeneration;
}

export function isCurrentDatasetAccessRefresh(generation) {
    return generation === refreshGeneration;
}

export function getDatasetAccessResponseGeneration(response) {
    return response && typeof response === 'object' ? acceptedResponses.get(response) : undefined;
}

export function subscribeDatasetAccessRegistry(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function clearDatasetAccessRegistry() {
    readableDatasetNames.clear();
    hasSnapshot = false;
    refreshGeneration += 1;
    notifySnapshotChanged();
}

export function primeDatasetAccessRegistry(contentTablesResponse = null, generation = null) {
    if (generation !== null && !isCurrentDatasetAccessRefresh(generation)) return false;
    if (generation === null) clearDatasetAccessRegistry();
    readableDatasetNames.clear();

    const datasets = Array.isArray(contentTablesResponse?.datasets)
        ? contentTablesResponse.datasets
        : [];

    datasets.forEach((datasetEntry) => {
        const datasetName = String(datasetEntry?.dataset_name || '').trim();
        if (!datasetName) {
            return;
        }

        if (datasetEntry?.can_read_rows === false) {
            return;
        }

        readableDatasetNames.add(datasetName);
    });

    hasSnapshot = true;
    if (contentTablesResponse && typeof contentTablesResponse === 'object') {
        acceptedResponses.set(contentTablesResponse, refreshGeneration);
    }
    notifySnapshotChanged();
    return true;
}

export function hasDatasetAccessSnapshot() {
    return hasSnapshot;
}

export function canReadDatasetFromRegistry(datasetName) {
    const normalizedDatasetName = String(datasetName || '').trim();
    if (!normalizedDatasetName || !hasSnapshot) {
        return null;
    }
    return readableDatasetNames.has(normalizedDatasetName);
}
