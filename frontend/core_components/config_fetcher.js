// config_fetcher.js
// Fetches and caches runtime configuration used by the frontend.
// Bridges the config endpoint with view-level consumers that need shared UI settings.
// Exists to centralize frontend config loading and avoid duplicate fetch/caching logic.

import { endpoint_router } from '../core_components/endpoints/endpoint_router.js';

let configCache = null;
let configPromise = null;
const CROSS_TAB_LOGIN_SYNC_KEYS = ['cross_tab_login_sync', 'concatenate_login'];

function readBooleanConfig(config, keys, fallback = false) {
    if (!config || typeof config !== 'object') {
        return fallback;
    }

    for (const key of keys) {
        if (typeof config[key] === 'boolean') {
            return config[key];
        }
    }

    return fallback;
}

export function loadConfig() {
    if (!configPromise) {
        configPromise = endpoint_router('fetchConfig')
            .then(json => {
                if (typeof json === 'string') {
                    try {
                        json = JSON.parse(json);
                    } catch (e) {
                        console.warn('Failed to parse config json string', e);
                    }
                }
                configCache = json;
                return json;
            })
            .catch(err => {
                console.warn('loadConfig failed', err);
                configPromise = null; // Reset so callers can retry on next invocation
                configCache = { default_view: 'card' };
                return configCache;
            });
    }
    return configPromise;
}

export function getDefaultViewSync() {
    return configCache?.default_view || 'card';
}

export async function getDefaultView() {
    if (configCache) {
        return configCache.default_view || 'card';
    }
    const cfg = await loadConfig();
    return cfg.default_view || 'card';
}

export function getDefaultDatasetSortSync(datasetName) {
    const configuredSort = configCache?.default_dataset_sorts?.[datasetName];
    const column = String(configuredSort?.column || '').trim();
    const direction = String(configuredSort?.direction || '').trim().toUpperCase();
    if (!column || !['ASC', 'DESC'].includes(direction)) {
        return { column: null, direction: null };
    }

    return { column, direction };
}

export function isCrossTabLoginSyncEnabledSync() {
    return readBooleanConfig(configCache, CROSS_TAB_LOGIN_SYNC_KEYS, false);
}

export async function isCrossTabLoginSyncEnabled() {
    if (configCache) {
        return isCrossTabLoginSyncEnabledSync();
    }

    const cfg = await loadConfig();
    return readBooleanConfig(cfg, CROSS_TAB_LOGIN_SYNC_KEYS, false);
}
