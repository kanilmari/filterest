// dataset_access_registry.js
// Tracks the latest dataset-read access snapshot returned by the datasets endpoint.
// Bridges fetchContentTables responses and later navigation permission checks.
// Exists to let dataset navigation trust the already-filtered dataset list instead of re-checking /api/get-results one table at a time.

const readableDatasetNames = new Set();
let hasSnapshot = false;

export function clearDatasetAccessRegistry() {
    readableDatasetNames.clear();
    hasSnapshot = false;
}

export function primeDatasetAccessRegistry(contentTablesResponse = null) {
    clearDatasetAccessRegistry();

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
