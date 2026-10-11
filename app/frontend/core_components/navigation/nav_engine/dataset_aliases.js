// dataset_aliases.js
// Keeps compatibility path/name helpers for callers migrating to dataset identities.
// Bridges navigation and the single readable catalogue in dataset_access_registry.
// Contains no fetching, cache, permission gate, prefix inference or fallback aliases.

import { getDatasetAccessSnapshot, refreshDatasetCatalogue, resolveDataset } from './dataset_access_registry.js';

/** Compatibility refresh keeps the former immutable map shape, using only the accepted catalogue. */
export async function refreshDatasetAliasRegistry(options = {}) {
    await refreshDatasetCatalogue(options);
    const rawToPublic = {};
    const publicToRaw = {};
    for (const entry of getDatasetAccessSnapshot()?.datasets || []) {
        const resolved = resolveDataset({ name: entry.dataset_name });
        if (resolved.status !== 'found') continue;
        const dataset = resolved.dataset;
        if (dataset.preferred_name !== dataset.dataset_name) rawToPublic[dataset.dataset_name] = dataset.preferred_name;
        for (const name of dataset.names) {
            if (name !== dataset.dataset_name) publicToRaw[name] = dataset.dataset_name;
        }
    }
    return Object.freeze({ rawToPublic: Object.freeze(rawToPublic), publicToRaw: Object.freeze(publicToRaw) });
}

/** Prefers the name supplied by the server; custom/unknown routes keep their input. */
export function getPublicDatasetName(name) {
    const resolved = resolveDataset({ name });
    return resolved.status === 'found' ? resolved.dataset.preferred_name : name;
}

/** Maps a readable name to its canonical table name without inventing aliases. */
export function getInternalDatasetName(name) {
    const resolved = resolveDataset({ name });
    return resolved.status === 'found' ? resolved.dataset.dataset_name : name;
}

/** Builds a path using the readable catalogue's preferred name. */
export function buildDatasetPath(name, prefix = '/') {
    return name ? `${prefix}${getPublicDatasetName(name)}` : (prefix || '/');
}

/** Existing namespace guidance for the alias editor. */
export function getDatasetRouteUniquenessHint() {
    return 'Dataset name also reserves its URL route. Keep it unique; app_ datasets auto-reserve the stripped public alias (for example app_service_catalog -> service_catalog), while system_ stripped aliases stay opt-in only.';
}
