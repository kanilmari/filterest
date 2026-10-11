// dataset_access_registry.js
// Owns the readable dataset catalogue and immutable name/uid resolution snapshots.
// Bridges /api/datasets, bootstrap, alias saves and navigation permission checks.
// Keeps freshness beside page memory and rejects obsolete identity/refresh responses.

import { endpoint_router } from '../../endpoints/endpoint_router.js';
import { subscribeToSessionGeneration } from '../../auth/session_generation_store.js';

/** @typedef {import('../../../generated/go_contract_types').DatasetCatalogueEntry} DatasetCatalogueEntry */

const REFRESH_TTL_MS = 60 * 1000;
let datasetsByName = new Map();
let datasetsByUID = new Map();
let hasSnapshot = false;
let refreshGeneration = 0;
let acceptedGeneration = null;
let loadedAt = null;
let acceptedResponse = null;
let refreshPromise = null;
const acceptedResponses = new WeakMap();
const listeners = new Set();

function notifySnapshotChanged() {
    for (const listener of listeners) listener(acceptedResponse);
}

/** Starts a bootstrap/permission refresh; older responses may no longer grant access. */
export function beginDatasetAccessRefresh() {
    clearDatasetAccessRegistry();
    return refreshGeneration;
}

export function isCurrentDatasetAccessRefresh(generation) {
    return generation === refreshGeneration;
}

/** Request ordering is separate from the last accepted snapshot's validity. */
export function isAcceptedDatasetAccessSnapshot(generation) {
    return hasSnapshot && generation === acceptedGeneration;
}

export function getDatasetAccessSnapshot() {
    return acceptedResponse;
}

export function getDatasetAccessResponseGeneration(response) {
    return response && typeof response === 'object' ? acceptedResponses.get(response) : undefined;
}

export function subscribeDatasetAccessRegistry(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/** Invalidates all names and in-flight work when identity or permissions change. */
export function clearDatasetAccessRegistry() {
    datasetsByName = new Map();
    datasetsByUID = new Map();
    hasSnapshot = false;
    loadedAt = null;
    acceptedResponse = null;
    acceptedGeneration = null;
    refreshPromise = null;
    refreshGeneration += 1;
    notifySnapshotChanged();
}

/**
 * Atomically replaces both indexes from a successful permission-filtered catalogue.
 * @param {{datasets: DatasetCatalogueEntry[]}|null} response
 */
export function primeDatasetAccessRegistry(response = null, generation = null) {
    if (generation !== null && !isCurrentDatasetAccessRefresh(generation)) return false;
    if (!Array.isArray(response?.datasets)) return false;
    if (generation === null) clearDatasetAccessRegistry();
    const byName = new Map();
    const byUID = new Map();
    for (const entry of response.datasets) {
        const canonicalName = String(entry?.dataset_name || '').trim();
        if (!canonicalName || entry.can_read_rows === false) continue;
        const offeredNames = Array.isArray(entry.names) ? entry.names.filter(name => typeof name === 'string' && name) : [];
        const names = Object.freeze([...new Set([canonicalName, ...offeredNames])]);
        // Older metadata may omit the uid; its registry-row id never substitutes for it.
        const uid = Number(entry.table_uid);
        const dataset = Object.freeze({ ...entry, dataset_name: canonicalName,
            table_uid: Number.isSafeInteger(uid) && uid > 0 ? uid : null,
            names, preferred_name: names.includes(entry.preferred_name) ? entry.preferred_name : canonicalName });
        for (const name of names) byName.set(name, dataset);
        if (dataset.table_uid !== null) byUID.set(dataset.table_uid, dataset);
    }
    datasetsByName = byName;
    datasetsByUID = byUID;
    hasSnapshot = true;
    loadedAt = Date.now();
    acceptedResponse = response;
    acceptedGeneration = refreshGeneration;
    acceptedResponses.set(response, refreshGeneration);
    notifySnapshotChanged();
    return true;
}

// Returning to a live page must not keep names/visibility from before the visit
// away. A cold page has no snapshot and waits for verified auth bootstrap.
if (typeof window !== 'undefined') {
    window.addEventListener('pageshow', event => {
        if (event.persisted && hasSnapshot) void refreshDatasetCatalogue({ force: true });
    });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && hasSnapshot) void refreshDatasetCatalogue({ force: true });
    });
}

export function hasDatasetAccessSnapshot() {
    return hasSnapshot;
}

/** Resolves only server-offered readable names/identities; never infers prefixes. */
export function resolveDataset({ name, uid } = {}) {
    if (!hasSnapshot) return { status: 'not_ready' };
    const byName = name === undefined ? null : datasetsByName.get(String(name).trim());
    const byUID = uid === undefined ? null : datasetsByUID.get(Number(uid));
    const dataset = name === undefined ? byUID : byName;
    if (!dataset || (uid !== undefined && dataset !== byUID)) return { status: 'unknown' };
    return { status: 'found', dataset };
}

export function canReadDatasetFromRegistry(name) {
    if (!String(name || '').trim() || !hasSnapshot) return null;
    return resolveDataset({ name }).status === 'found';
}

/**
 * Refreshes the same catalogue for guests, readers and admins. Forced saves bypass
 * both TTL and earlier requests. Failures retain the last snapshot but are never
 * fresh; empty successful catalogues replace it. Auth transitions clear it above.
 */
export async function refreshDatasetCatalogue({ force = false } = {}) {
    if (!force && loadedAt !== null && Date.now() - loadedAt < REFRESH_TTL_MS) return acceptedResponse;
    if (!force && refreshPromise) return refreshPromise;
    const generation = ++refreshGeneration;
    loadedAt = null;
    const pending = (async () => {
        try {
            const response = await endpoint_router('fetchContentTables', {
                suppressAuthRedirect: true, suppressErrorToast: true,
            });
            return primeDatasetAccessRegistry(response, generation) ? response : null;
        } catch (error) {
            console.warn('[dataset_catalogue] refresh failed', error);
            return null;
        } finally {
            if (isCurrentDatasetAccessRefresh(generation)) refreshPromise = null;
        }
    })();
    refreshPromise = pending;
    return pending;
}

// Session privacy invalidation is independent of optional cross-tab login sync.
// Focus/suspension only request revalidation; explicit identity changes revoke names.
subscribeToSessionGeneration(reason => {
    if (!['blur', 'focus', 'suspend', 'resume', 'restore'].includes(reason)) clearDatasetAccessRegistry();
});
