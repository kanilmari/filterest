// route_permission_checker.js
// Applies route-based permission checks to frontend UI elements and actions.
// Bridges cached route-right data with button/view availability across datasets and custom views.
// Exists to centralize route-permission enforcement on the client side.

import { hasCachedRouteRights } from './permission_cache_reader.js';
import { endpoint_router } from '../core_components/endpoints/endpoint_router.js';
import { clearDatasetAccessRegistry } from './navigation/nav_engine/dataset_access_registry.js';

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Cache stores { value: boolean, timestamp: number } per "route|dataset" key
const datasetPermissionCache = new Map();
// In-flight map stores Promise<boolean> per "route|dataset" key so concurrent callers dedupe.
const datasetPermissionInflight = new Map();
// Dataset batch map stores { promise, routes:Set<string> } per dataset scope key.
const datasetPermissionBatchInflight = new Map();
// Multi-dataset batch map stores Promise<Map<scopeKey, allowedByRoute>> per normalized request payload.
const datasetPermissionMultiBatchInflight = new Map();
let datasetPermissionCacheGeneration = 0;

function buildDatasetScopeKey(dataset, datasetUid = '') {
    return `${dataset}|${datasetUid}`;
}

function buildDatasetPermissionKey(route, dataset, datasetUid = '') {
    return `${route}|${buildDatasetScopeKey(dataset, datasetUid)}`;
}

function getFreshCacheEntry(key) {
    const cached = datasetPermissionCache.get(key);
    if (!cached) {
        return null;
    }
    if ((Date.now() - cached.timestamp) >= CACHE_TTL_MS) {
        return null;
    }
    return cached;
}

function normalizeRequestedRoutes(routes = []) {
    const seen = new Set();
    const normalized = [];
    routes.forEach((route) => {
        const trimmed = String(route || '').trim();
        if (!trimmed || seen.has(trimmed)) {
            return;
        }
        seen.add(trimmed);
        normalized.push(trimmed);
    });
    return normalized;
}

function buildAllowedByRoute(routes, source = {}, defaultValue = false) {
    return Object.fromEntries(
        routes.map((route) => [route, Boolean(source?.[route] ?? defaultValue)])
    );
}

function normalizeDatasetPermissionRequests(requests = []) {
    const byScope = new Map();

    requests.forEach((request) => {
        const dataset = String(request?.dataset || '').trim();
        const datasetUid = String(request?.datasetUid || request?.dataset_uid || '').trim();
        const routes = normalizeRequestedRoutes(request?.routes || []);
        if (!dataset || routes.length === 0) {
            return;
        }

        const scopeKey = buildDatasetScopeKey(dataset, datasetUid);
        const existing = byScope.get(scopeKey);
        if (!existing) {
            byScope.set(scopeKey, {
                dataset,
                datasetUid,
                routes: [...routes],
            });
            return;
        }

        const seenRoutes = new Set(existing.routes);
        routes.forEach((route) => {
            if (!seenRoutes.has(route)) {
                existing.routes.push(route);
                seenRoutes.add(route);
            }
        });
    });

    return Array.from(byScope.values()).sort((left, right) =>
        buildDatasetScopeKey(left.dataset, left.datasetUid)
            .localeCompare(buildDatasetScopeKey(right.dataset, right.datasetUid))
    );
}

function buildDatasetPermissionMultiBatchKey(requests = []) {
    return JSON.stringify(
        requests.map((request) => ({
            dataset: request.dataset,
            dataset_uid: request.datasetUid,
            routes: [...request.routes].sort(),
        }))
    );
}

function cacheAllowedByRoute(dataset, datasetUid, allowedByRoute, callGeneration) {
    if (datasetPermissionCacheGeneration !== callGeneration) {
        return;
    }

    const cachedAt = Date.now();
    Object.entries(allowedByRoute).forEach(([route, allowed]) => {
        datasetPermissionCache.set(
            buildDatasetPermissionKey(route, dataset, datasetUid),
            { value: Boolean(allowed), timestamp: cachedAt }
        );
    });
}

/**
 * Clears the dataset permission cache. Call on logout or role change to
 * prevent stale permissions from persisting across sessions.
 */
export function clearPermissionCache() {
    datasetPermissionCacheGeneration += 1;
    datasetPermissionCache.clear();
    datasetPermissionInflight.clear();
    datasetPermissionBatchInflight.clear();
    datasetPermissionMultiBatchInflight.clear();
    clearDatasetAccessRegistry();
}

export function hasRoutePermission(route) {
    return hasCachedRouteRights(route);
}

export function applyPermission(element, route, { hide = true, remove = false } = {}) {
    if (hasCachedRouteRights(route)) {
        return true;
    }
    if (remove) {
        element.remove();
    } else if (hide) {
        element.style.display = 'none';
        element.classList.add('permission-hidden');
    } else {
        element.disabled = true;
    }
    return false;
}

/**
 * Seeds a dataset-scoped permission batch so later per-route checks can reuse
 * one backend round-trip instead of fanning out one request per control.
 */
export async function primeDatasetPermissions(dataset, routes, { datasetUid = '' } = {}) {
    const normalizedRoutes = normalizeRequestedRoutes(routes);
    if (!dataset || normalizedRoutes.length === 0) {
        return {};
    }

    const scopeKey = buildDatasetScopeKey(dataset, datasetUid);
    const missingRoutes = normalizedRoutes.filter((route) => {
        const key = buildDatasetPermissionKey(route, dataset, datasetUid);
        return !getFreshCacheEntry(key);
    });

    if (missingRoutes.length === 0) {
        return buildAllowedByRoute(
            normalizedRoutes,
            Object.fromEntries(
                normalizedRoutes.map((route) => {
                    const key = buildDatasetPermissionKey(route, dataset, datasetUid);
                    return [route, getFreshCacheEntry(key)?.value === true];
                })
            )
        );
    }

    const existingBatch = datasetPermissionBatchInflight.get(scopeKey);
    if (existingBatch) {
        try {
            await existingBatch.promise;
        } catch {
            // Fall through and retry only the still-missing routes below.
        }
        return primeDatasetPermissions(dataset, normalizedRoutes, { datasetUid });
    }

    const callGeneration = datasetPermissionCacheGeneration;
    let requestPromise;
    requestPromise = (async () => {
        try {
            const result = await endpoint_router('checkTableRights', {
                method: 'POST',
                body_data: {
                    dataset,
                    dataset_uid: datasetUid,
                    routes: missingRoutes,
                },
            });
            const allowedByRoute = buildAllowedByRoute(
                missingRoutes,
                result?.allowed_by_route || {}
            );
            cacheAllowedByRoute(dataset, datasetUid, allowedByRoute, callGeneration);
            return allowedByRoute;
        } catch (err) {
            if (err.isRateLimited || err.status === 429) {
                console.debug('primeDatasetPermissions: rate-limited, skipping cache', scopeKey);
                return buildAllowedByRoute(missingRoutes, {}, true);
            }
            console.warn('primeDatasetPermissions error', err);
            return null;
        } finally {
            const inflight = datasetPermissionBatchInflight.get(scopeKey);
            if (inflight?.promise === requestPromise) {
                datasetPermissionBatchInflight.delete(scopeKey);
            }
        }
    })();

    datasetPermissionBatchInflight.set(scopeKey, {
        promise: requestPromise,
        routes: new Set(missingRoutes),
    });

    const batchResult = await requestPromise;
    if (batchResult) {
        return buildAllowedByRoute(normalizedRoutes, {
            ...batchResult,
            ...Object.fromEntries(
                normalizedRoutes.map((route) => {
                    const key = buildDatasetPermissionKey(route, dataset, datasetUid);
                    return [route, getFreshCacheEntry(key)?.value === true];
                })
            ),
        });
    }

    return buildAllowedByRoute(
        normalizedRoutes,
        Object.fromEntries(
            normalizedRoutes.map((requestedRoute) => {
                const key = buildDatasetPermissionKey(requestedRoute, dataset, datasetUid);
                return [requestedRoute, getFreshCacheEntry(key)?.value === true];
            })
        )
    );
}

export async function primeMultipleDatasetPermissions(requests = []) {
    const normalizedRequests = normalizeDatasetPermissionRequests(requests);
    if (normalizedRequests.length === 0) {
        return new Map();
    }

    if (normalizedRequests.length === 1) {
        const onlyRequest = normalizedRequests[0];
        const allowedByRoute = await primeDatasetPermissions(
            onlyRequest.dataset,
            onlyRequest.routes,
            { datasetUid: onlyRequest.datasetUid }
        );
        return new Map([
            [
                buildDatasetScopeKey(onlyRequest.dataset, onlyRequest.datasetUid),
                allowedByRoute,
            ],
        ]);
    }

    const pendingRequests = normalizedRequests
        .map((request) => {
            const missingRoutes = request.routes.filter((route) => {
                const key = buildDatasetPermissionKey(route, request.dataset, request.datasetUid);
                return !getFreshCacheEntry(key);
            });
            return {
                ...request,
                routes: missingRoutes,
            };
        })
        .filter((request) => request.routes.length > 0);

    if (pendingRequests.length > 0) {
        const requestKey = buildDatasetPermissionMultiBatchKey(pendingRequests);
        let requestPromise = datasetPermissionMultiBatchInflight.get(requestKey);
        if (!requestPromise) {
            const callGeneration = datasetPermissionCacheGeneration;
            requestPromise = (async () => {
                try {
                    const result = await endpoint_router('checkTableRightsMulti', {
                        method: 'POST',
                        body_data: {
                            items: pendingRequests.map((request) => ({
                                dataset: request.dataset,
                                dataset_uid: request.datasetUid,
                                routes: request.routes,
                            })),
                        },
                    });

                    const responseResults = Array.isArray(result?.results)
                        ? result.results
                        : [];

                    const allowedByScope = new Map();
                    responseResults.forEach((item) => {
                        const dataset = String(item?.dataset || '').trim();
                        const datasetUid = String(item?.dataset_uid || '').trim();
                        if (!dataset) {
                            return;
                        }

                        const scopeKey = buildDatasetScopeKey(dataset, datasetUid);
                        const requestForScope = pendingRequests.find((request) =>
                            buildDatasetScopeKey(request.dataset, request.datasetUid) === scopeKey
                        );
                        const normalizedRoutes = requestForScope?.routes || [];
                        const allowedByRoute = buildAllowedByRoute(
                            normalizedRoutes,
                            item?.allowed_by_route || {}
                        );
                        cacheAllowedByRoute(dataset, datasetUid, allowedByRoute, callGeneration);
                        allowedByScope.set(scopeKey, allowedByRoute);
                    });

                    return allowedByScope;
                } catch (err) {
                    if (err.isRateLimited || err.status === 429) {
                        console.debug('primeMultipleDatasetPermissions: rate-limited, skipping cache');
                        return null;
                    }
                    console.warn('primeMultipleDatasetPermissions error', err);
                    return null;
                } finally {
                    if (datasetPermissionMultiBatchInflight.get(requestKey) === requestPromise) {
                        datasetPermissionMultiBatchInflight.delete(requestKey);
                    }
                }
            })();
            datasetPermissionMultiBatchInflight.set(requestKey, requestPromise);
        }

        try {
            await requestPromise;
        } catch {
            // Per-scope fallback happens below via the single-dataset primer.
        }
    }

    const results = new Map();
    for (const request of normalizedRequests) {
        const allowedByRoute = await primeDatasetPermissions(
            request.dataset,
            request.routes,
            { datasetUid: request.datasetUid }
        );
        results.set(
            buildDatasetScopeKey(request.dataset, request.datasetUid),
            allowedByRoute
        );
    }
    return results;
}

export async function hasDatasetPermission(route, dataset, { datasetUid = '' } = {}) {
    const key = buildDatasetPermissionKey(route, dataset, datasetUid);
    const cached = getFreshCacheEntry(key);
    if (cached) {
        return cached.value;
    }

    const batchScopeKey = buildDatasetScopeKey(dataset, datasetUid);
    const batchInflight = datasetPermissionBatchInflight.get(batchScopeKey);
    if (batchInflight?.routes.has(route)) {
        try {
            await batchInflight.promise;
        } catch {
            // Fall back to the single-route request below if batch priming failed.
        }
        const postBatchCached = getFreshCacheEntry(key);
        if (postBatchCached) {
            return postBatchCached.value;
        }
    }

    const inflight = datasetPermissionInflight.get(key);
    if (inflight) {
        return inflight;
    }

    const callGeneration = datasetPermissionCacheGeneration;
    let requestPromise;
    requestPromise = (async () => {
        try {
            // Dataset-scoped rights must come from the backend source of truth.
            // The sessionStorage route list can be stale after permission grants,
            // so treating a missing cached route as an authoritative deny would
            // hide controls like the big-card edit button incorrectly.
            const result = await endpoint_router('checkTableRight', {
                url_params: `?route=${encodeURIComponent(route)}&dataset=${encodeURIComponent(dataset)}`
                    + (datasetUid ? `&dataset_uid=${encodeURIComponent(datasetUid)}` : ''),
            });
            const allowed = Boolean(result && result.allowed);
            if (datasetPermissionCacheGeneration === callGeneration) {
                datasetPermissionCache.set(key, { value: allowed, timestamp: Date.now() });
            }
            return allowed;
        } catch (err) {
            // Rate-limited requests are not permission denials — don't cache false
            if (err.isRateLimited || err.status === 429) {
                console.debug('hasDatasetPermission: rate-limited, skipping cache', key);
                return true;
            }
            console.warn('hasDatasetPermission error', err);
            if (datasetPermissionCacheGeneration === callGeneration) {
                datasetPermissionCache.set(key, { value: false, timestamp: Date.now() });
            }
            return false;
        } finally {
            if (datasetPermissionInflight.get(key) === requestPromise) {
                datasetPermissionInflight.delete(key);
            }
        }
    })();

    datasetPermissionInflight.set(key, requestPromise);
    return requestPromise;
}
