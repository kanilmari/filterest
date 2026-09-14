// dataset_query_adapter_registry.js
// Registers query adapters for explicitly mounted non-table data surfaces.
// Between shared search/filter entry points and an authorized extension data source.
// Keeps ordinary dataset execution unchanged when no adapter owns the surface.

const adapters = new Map();

export function registerDatasetQueryAdapter(datasetName, adapter) {
    if (!/^[a-z][a-z0-9_]*$/.test(datasetName) || typeof adapter?.refresh !== 'function') {
        throw new TypeError('A query adapter needs a stable dataset name and refresh function');
    }
    if (adapters.has(datasetName)) throw new Error(`Query adapter already mounted: ${datasetName}`);
    adapters.set(datasetName, adapter);
    return () => {
        if (adapters.get(datasetName) === adapter) adapters.delete(datasetName);
    };
}

export function getDatasetQueryAdapter(datasetName) {
    return adapters.get(datasetName) || null;
}
