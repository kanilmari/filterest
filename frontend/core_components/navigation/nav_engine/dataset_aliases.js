// dataset_aliases.js
// Resolves dataset table names to public-facing URL aliases and back.
// Bridges SPA routing/path generation with canonical raw system_db_tables.table_name values.
// Exists to keep dataset alias hydration centralized while the read surface moves off datasetNames.

import { endpoint_router } from '../../endpoints/endpoint_router.js';
import { hasRoutePermission } from '../../route_permission_checker.js';

const FALLBACK_RAW_TO_ALIAS = Object.freeze({
    app_service_catalog: 'service_catalog',
});

const DATASET_ROUTE_UNIQUENESS_HINT =
    'Dataset name also reserves its URL route. Keep it unique; app_ datasets auto-reserve the stripped public alias (for example app_service_catalog -> service_catalog), while system_ stripped aliases stay opt-in only.';
const DATASET_ALIAS_REFRESH_TTL_MS = 60 * 1000;
const DATASET_ALIAS_REFRESH_TS_KEY = 'easelect_dataset_alias_refresh_at';

let datasetAliasRegistry = buildAliasRegistry(FALLBACK_RAW_TO_ALIAS);
let datasetAliasAutoRefreshStarted = false;
let datasetAliasRefreshPromise = null;
let datasetAliasLastRefreshAt = 0;

function isKnownGuestShell() {
    return localStorage.getItem('button_state') !== 'logout';
}

function canReadDatasetAliases() {
    return hasRoutePermission('/api/dataset-aliases')
        || hasRoutePermission('/api/dataset-names');
}

function buildAliasRegistry(rawToAlias) {
    return Object.freeze({
        rawToPublic: Object.freeze({ ...rawToAlias }),
        publicToRaw: Object.freeze(
            Object.fromEntries(
                Object.entries(rawToAlias).map(([rawName, publicName]) => [publicName, rawName])
            )
        ),
    });
}

function isAliasRegistryFresh() {
    if (datasetAliasLastRefreshAt <= 0) {
        try {
            const storedTimestamp = Number.parseInt(localStorage.getItem(DATASET_ALIAS_REFRESH_TS_KEY) || '', 10);
            if (Number.isFinite(storedTimestamp)) {
                datasetAliasLastRefreshAt = storedTimestamp;
            }
        } catch {
            // Ignore storage access failures and fall back to in-memory freshness only.
        }
    }
    return datasetAliasLastRefreshAt > 0
        && (Date.now() - datasetAliasLastRefreshAt) < DATASET_ALIAS_REFRESH_TTL_MS;
}

function rememberAliasRefreshTimestamp(timestamp) {
    datasetAliasLastRefreshAt = timestamp;
    try {
        localStorage.setItem(DATASET_ALIAS_REFRESH_TS_KEY, String(timestamp));
    } catch {
        // Ignore storage access failures in alias bootstrap.
    }
}

function deriveAliasRegistryFromDatasetNames(datasetNames) {
    const rawNames = new Set(datasetNames.filter((name) => typeof name === 'string' && name.trim()));
    const rawToPublic = {};

    for (const rawName of rawNames) {
        if (!rawName.startsWith('app_')) {
            continue;
        }

        const candidate = rawName.slice('app_'.length);
        if (candidate && !rawNames.has(candidate)) {
            rawToPublic[rawName] = candidate;
        }
    }

    for (const [rawName, publicName] of Object.entries(FALLBACK_RAW_TO_ALIAS)) {
        if (rawNames.has(rawName) && !rawNames.has(publicName) && !rawToPublic[rawName]) {
            rawToPublic[rawName] = publicName;
        }
    }

    return buildAliasRegistry(rawToPublic);
}

function normalizeAliasMap(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return {};
    }

    return Object.fromEntries(
        Object.entries(payload).filter(
            ([rawName, publicName]) =>
                typeof rawName === 'string' &&
                rawName.trim() &&
                typeof publicName === 'string' &&
                publicName.trim()
        )
    );
}

function extractRawToPublicAliases(payload) {
    for (const candidate of [
        payload?.raw_to_public,
        payload?.rawToPublic,
        payload?.aliases?.raw_to_public,
        payload?.aliases?.rawToPublic,
    ]) {
        const normalized = normalizeAliasMap(candidate);
        if (Object.keys(normalized).length > 0) {
            return normalized;
        }
    }

    return {};
}

function normalizeDatasetNamesResponse(payload) {
    const aliases = extractRawToPublicAliases(payload);

    if (Array.isArray(payload)) {
        return {
            names: payload,
            aliasRegistry: null,
        };
    }

    if (payload && Array.isArray(payload.names)) {
        return {
            names: payload.names,
            aliasRegistry: Object.keys(aliases).length > 0 ? buildAliasRegistry(aliases) : null,
        };
    }

    if (payload && Array.isArray(payload.datasets)) {
        return {
            names: payload.datasets.map((entry) => {
                if (typeof entry === 'string') {
                    return entry;
                }
                return entry?.table_name || entry?.dataset || entry?.name || '';
            }),
            aliasRegistry: Object.keys(aliases).length > 0 ? buildAliasRegistry(aliases) : null,
        };
    }

    return {
        names: null,
        aliasRegistry: Object.keys(aliases).length > 0 ? buildAliasRegistry(aliases) : null,
    };
}

function normalizeAliasRegistryResponse(payload) {
    const aliases = extractRawToPublicAliases(payload);
    if (Object.keys(aliases).length === 0) {
        return null;
    }
    return buildAliasRegistry(aliases);
}

async function requestDedicatedAliasRegistry() {
    const response = await endpoint_router('datasetAliases', {
        suppressAuthRedirect: true,
    });
    return normalizeAliasRegistryResponse(response);
}

async function requestDatasetNamesAliasFallback() {
    const response = await endpoint_router('datasetNames', {
        url_params: '?with_aliases=1',
        suppressAuthRedirect: true,
    });
    const { names, aliasRegistry } = normalizeDatasetNamesResponse(response);
    if (aliasRegistry) {
        return aliasRegistry;
    }
    if (Array.isArray(names) && names.length > 0) {
        return deriveAliasRegistryFromDatasetNames(names);
    }
    return null;
}

async function loadDatasetAliasRegistry() {
    let dedicatedError = null;

    try {
        const dedicatedRegistry = await requestDedicatedAliasRegistry();
        if (dedicatedRegistry) {
            return dedicatedRegistry;
        }
    } catch (error) {
        dedicatedError = error;
    }

    try {
        const fallbackRegistry = await requestDatasetNamesAliasFallback();
        if (fallbackRegistry) {
            return fallbackRegistry;
        }
    } catch (error) {
        if (dedicatedError) {
            console.warn('[dataset_aliases] failed to refresh dataset alias registry', {
                dedicatedEndpointError: dedicatedError,
                datasetNamesFallbackError: error,
            });
        } else {
            console.warn('[dataset_aliases] failed to refresh dataset alias registry', error);
        }
    }

    return datasetAliasRegistry;
}

function queueDatasetAliasRegistryRefresh() {
    if (isKnownGuestShell() || !canReadDatasetAliases()) {
        return Promise.resolve(datasetAliasRegistry);
    }

    if (isAliasRegistryFresh()) {
        return Promise.resolve(datasetAliasRegistry);
    }

    if (!datasetAliasRefreshPromise && !datasetAliasAutoRefreshStarted) {
        datasetAliasAutoRefreshStarted = true;
        datasetAliasRefreshPromise = (async () => {
            try {
                datasetAliasRegistry = await loadDatasetAliasRegistry();
                rememberAliasRefreshTimestamp(Date.now());
            } finally {
                datasetAliasRefreshPromise = null;
            }

            return datasetAliasRegistry;
        })();
    }

    return datasetAliasRefreshPromise;
}

/**
 * Refresh the dataset alias registry from the dedicated backend alias surface.
 *
 * @returns {Promise<{rawToPublic: Object, publicToRaw: Object}>}
 */
export async function refreshDatasetAliasRegistry() {
    if (isKnownGuestShell() || !canReadDatasetAliases()) {
        return datasetAliasRegistry;
    }

    if (isAliasRegistryFresh()) {
        return datasetAliasRegistry;
    }

    if (datasetAliasRefreshPromise) {
        return datasetAliasRefreshPromise;
    }

    datasetAliasAutoRefreshStarted = true;
    datasetAliasRefreshPromise = (async () => {
        try {
            datasetAliasRegistry = await loadDatasetAliasRegistry();
            rememberAliasRefreshTimestamp(Date.now());
        } finally {
            datasetAliasRefreshPromise = null;
        }

        return datasetAliasRegistry;
    })();

    return datasetAliasRefreshPromise;
}

/**
 * Resolve the public URL segment for a raw internal dataset name.
 *
 * @param {string|null|undefined} datasetName - Raw dataset/table name
 * @returns {string|null|undefined} Alias when known, otherwise the original name
 */
export function getPublicDatasetName(datasetName) {
    if (!datasetName) {
        return datasetName;
    }
    if (!datasetAliasRefreshPromise && !isKnownGuestShell() && canReadDatasetAliases()) {
        void queueDatasetAliasRegistryRefresh();
    }
    return datasetAliasRegistry.rawToPublic[datasetName] || datasetName;
}

/**
 * Resolve a raw internal dataset name from either a raw name or a public alias.
 *
 * @param {string|null|undefined} datasetName - Raw name or alias from the URL
 * @returns {string|null|undefined} Raw dataset/table name when known
 */
export function getInternalDatasetName(datasetName) {
    if (!datasetName) {
        return datasetName;
    }
    if (!datasetAliasRefreshPromise && !isKnownGuestShell() && canReadDatasetAliases()) {
        void queueDatasetAliasRegistryRefresh();
    }
    return datasetAliasRegistry.publicToRaw[datasetName] || datasetName;
}

/**
 * Build a dataset path while preferring the public alias when one exists.
 *
 * @param {string} datasetName - Raw internal dataset name
 * @param {string} [prefix='/'] - Route prefix such as "/" or "/admin/"
 * @returns {string} Dataset path for browser history/navigation
 */
export function buildDatasetPath(datasetName, prefix = '/') {
    if (!datasetName) {
        return prefix || '/';
    }
    return `${prefix}${getPublicDatasetName(datasetName)}`;
}

/**
 * Explain the current dataset route-namespace uniqueness contract in one short UI-safe sentence.
 *
 * @returns {string} User-facing reminder about raw names and app_ alias reservation
 */
export function getDatasetRouteUniquenessHint() {
    return DATASET_ROUTE_UNIQUENESS_HINT;
}
