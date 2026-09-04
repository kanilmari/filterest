// stable_endpoint_router.js
// Provides typed wrappers for the small stable API island layered on top of endpoint_router.js.
// Bridges stable auth/admin contracts and the generic pipeline without changing dynamic CRUD callers.
// Exists to start Phase B hybrid migration while keeping most dataset-shaped routes on the plain endpoint router.

import { endpoint_router } from './endpoint_router.js';
import { getStableCandidateRouteDescriptor, getTypedStableRouteDescriptor } from './stable_api_inventory.js';
import { createStableApiClient } from '../../generated/stable_api_client.js';

/** @typedef {import('../../generated/go_contract_types').AuthModesResponse} AuthModesResponse */
/** @typedef {import('../../generated/go_contract_types').UserPermissionsResponse} UserPermissionsResponse */
/** @typedef {import('../../generated/go_contract_types').FKCacheTriggersResponse} FKCacheTriggersResponse */
/** @typedef {import('../../generated/go_contract_types').FKCacheRefreshRequest} FKCacheRefreshRequest */
/** @typedef {import('../../generated/go_contract_types').FKCacheRefreshResponse} FKCacheRefreshResponse */
/** @typedef {import('../../generated/go_contract_types').DatasetHeaderConfigResponse} DatasetHeaderConfigResponse */
/** @typedef {import('../../generated/go_contract_types').CardVisibilityColumn} CardVisibilityColumn */
/** @typedef {import('../../generated/go_contract_types').CardVisibilityResponse} CardVisibilityResponse */
/** @typedef {import('../../generated/go_contract_types').ChildTabConfigRow} ChildTabConfigRow */
/**
 * @typedef {object} DatasetAliasManagementEntry
 * @property {string} dataset_name
 * @property {number} table_uid
 * @property {string} stored_primary_alias
 * @property {string} effective_public_alias
 * @property {string} alias_source
 * @property {string} raw_dataset_path
 * @property {string} canonical_dataset_path
 * @property {string} public_dataset_path
 * @property {string} default_public_alias_candidate
 * @property {boolean} default_alias_auto_reserved
 */
/**
 * @typedef {object} DatasetAliasManagementSnapshot
 * @property {DatasetAliasManagementEntry[]} [datasets]
 * @property {string} [system_alias_policy_recommendation]
 */
/**
 * @typedef {object} SaveDatasetAliasManagementRequest
 * @property {string} dataset_name
 * @property {string} alias_slug
 */
/**
 * @typedef {object} SaveDatasetAliasManagementResponse
 * @property {string} [status]
 * @property {string} [message]
 * @property {DatasetAliasManagementEntry} [dataset]
 * @property {string} [system_alias_policy_recommendation]
 */
/**
 * @typedef {object} DatasetHeaderConfigSaveResponse
 * @property {string} [status]
 * @property {string} [message]
 * @property {DatasetHeaderConfigResponse} [config]
 */
/**
 * @typedef {object} UpdateCardVisibilityRequest
 * @property {string} table_name
 * @property {string} [card_details_layout]
 * @property {string} [card_style_variant]
 * @property {CardVisibilityColumn[]} columns
 */
/**
 * @typedef {object} UpdateCardVisibilityResponse
 * @property {string} [status]
 * @property {string} [message]
 */
/**
 * @typedef {object} SaveChildTabConfigRequest
 * @property {string} parent_table
 * @property {ChildTabConfigRow[]} tabs
 */
/**
 * @typedef {object} SaveChildTabConfigResponse
 * @property {string} [status]
 * @property {string} [message]
 */

/**
 * stable_endpoint_router forwards a stable allowlisted route through the generic pipeline.
 *
 * @template T
 * @param {string} route_name
 * @param {object} [options]
 * @returns {Promise<T>}
 */
export async function stable_endpoint_router(route_name, options = {}) {
    const descriptor = getTypedStableRouteDescriptor(route_name);
    if (!descriptor) {
        throw new Error(`Route "${route_name}" is outside the typed stable API island`);
    }

    return routeThroughManifestBackedDescriptor(route_name, descriptor, options);
}

const manifestBackedStableApiClient = createStableApiClient({
    requestAdapter: routeTypedStableClientRequestThroughEndpointRouter,
});

/**
 * fetchAuthModes returns the stable auth bootstrap payload.
 *
 * @returns {Promise<AuthModesResponse>}
 */
export async function fetchAuthModes() {
    return manifestBackedStableApiClient.fetchAuthModes();
}

/**
 * fetchUserPermissions returns the stable permission cache payload for the current user.
 *
 * @returns {Promise<UserPermissionsResponse>}
 */
export async function fetchUserPermissions() {
    return manifestBackedStableApiClient.fetchUserPermissions();
}

/**
 * fetchAdminVersionInfo returns protected runtime, release-channel, and update details.
 *
 * @param {object} [options]
 * @returns {Promise<{
 *   product_name: string,
 *   app_version: string,
 *   release_channel: string,
 *   artifact_purpose: string,
 *   public_distribution: boolean,
 *   latest_stable_version?: string,
 *   update_status: string,
 *   update_available: boolean,
 *   latest_release_url?: string,
 *   update_checked_at?: string,
 *   refresh_allowed_at?: string,
 *   upstream_check_performed: boolean,
 *   db_version: string,
 *   required_db_version: string,
 *   db_compatible: boolean,
 *   runtime_mode: string
 * }>}
 */
export async function fetchAdminVersionInfo(options = {}) {
    return stable_candidate_endpoint_router('adminVersionInfo', {
        ...options,
        method: 'GET',
    });
}

/**
 * checkAdminVersionInfoAgain requests an administrator-triggered upstream release check.
 * The backend coalesces overlapping requests and applies a short process-wide cooldown.
 *
 * @param {object} [options]
 * @returns {Promise<object>}
 */
export async function checkAdminVersionInfoAgain(options = {}) {
    return stable_candidate_endpoint_router('adminVersionInfo', {
        ...options,
        method: 'POST',
    });
}

/**
 * fetchFKCacheTriggers returns the admin maintenance snapshot for FK cache triggers.
 *
 * @returns {Promise<FKCacheTriggersResponse>}
 */
export async function fetchFKCacheTriggers() {
    return manifestBackedStableApiClient.fetchFKCacheTriggers();
}

/**
 * refreshFKCacheTrigger runs the typed FK cache refresh action for one trigger.
 *
 * @param {FKCacheRefreshRequest} request
 * @returns {Promise<FKCacheRefreshResponse>}
 */
export async function refreshFKCacheTrigger(request) {
    return manifestBackedStableApiClient.refreshFKCacheTrigger(request);
}

/**
 * fetchDatasetAliasManagement returns the admin alias editor snapshot for all datasets.
 *
 * @returns {Promise<DatasetAliasManagementSnapshot>}
 */
export async function fetchDatasetAliasManagement() {
    return stable_candidate_endpoint_router('getDatasetAliasManagement');
}

/**
 * saveDatasetAliasManagement posts one dataset alias update through the candidate wrapper.
 *
 * @param {SaveDatasetAliasManagementRequest} request
 * @returns {Promise<SaveDatasetAliasManagementResponse>}
 */
export async function saveDatasetAliasManagement(request) {
    return stable_candidate_endpoint_router('saveDatasetAliasManagement', {
        body_data: request,
    });
}

/**
 * fetchDatasetHeaderConfig returns the admin dataset header editor payload for one dataset.
 *
 * @param {string} datasetName
 * @returns {Promise<DatasetHeaderConfigResponse>}
 */
export async function fetchDatasetHeaderConfig(datasetName) {
    return stable_candidate_endpoint_router('getDatasetHeaderConfig', {
        url_params: datasetName,
    });
}

/**
 * saveDatasetHeaderConfig posts the multipart dataset header editor payload.
 *
 * @param {FormData} formData
 * @returns {Promise<DatasetHeaderConfigSaveResponse>}
 */
export async function saveDatasetHeaderConfig(formData) {
    return stable_candidate_endpoint_router('saveDatasetHeaderConfig', {
        body_data: formData,
    });
}

/**
 * fetchCardVisibility returns one table's card visibility configuration payload.
 *
 * @param {string} tableName
 * @returns {Promise<CardVisibilityResponse | CardVisibilityColumn[]>}
 */
export async function fetchCardVisibility(tableName) {
    return stable_candidate_endpoint_router('getCardVisibility', {
        url_params: tableName,
    });
}

/**
 * saveCardVisibility posts the admin card visibility update payload.
 *
 * @param {UpdateCardVisibilityRequest} request
 * @returns {Promise<UpdateCardVisibilityResponse>}
 */
export async function saveCardVisibility(request) {
    return stable_candidate_endpoint_router('updateCardVisibility', {
        body_data: request,
    });
}

/** Returns the safe filesystem symbol list and current dataset/field assignments. */
export async function fetchAdminSymbols() {
    return stable_candidate_endpoint_router('adminSymbols', { method: 'GET' });
}

/** Assigns one registered icon key to one dataset or field metadata row. */
export async function saveAdminSymbolAssignment(request) {
    return stable_candidate_endpoint_router('adminSymbols', {
        method: 'POST',
        body_data: request,
    });
}

/**
 * Returns the explicit administrator-only UI feature-flag allowlist.
 *
 * @returns {Promise<{ view_admin_cover_image_test_palette: boolean }>}
 */
export async function fetchAdminUIFeatureFlags() {
    return stable_candidate_endpoint_router('adminUiFeatureFlags');
}

/** Returns the public-safe dataset-cover and article timestamp presentation settings. */
export async function fetchSitePresentationSettings() {
    return stable_candidate_endpoint_router('sitePresentationSettings');
}

/** Returns the administrator-editable site presentation settings. */
export async function fetchAdminSitePresentationSettings() {
    return stable_candidate_endpoint_router('adminSitePresentationSettings', {
        method: 'GET',
    });
}

/** Atomically replaces the typed site presentation settings object. */
export async function saveAdminSitePresentationSettings(request) {
    return stable_candidate_endpoint_router('adminSitePresentationSettings', {
        method: 'POST',
        body_data: request,
    });
}

/**
 * fetchChildTabConfig returns the legacy-named child-tab editor payload for one parent table.
 * The payload drives reverse-FK "referring tab" UI copy even though the route name stays stable.
 *
 * @param {string} tableName
 * @returns {Promise<ChildTabConfigRow[]>}
 */
export async function fetchChildTabConfig(tableName) {
    return stable_candidate_endpoint_router('getChildTabConfig', {
        url_params: tableName,
    });
}

/**
 * saveChildTabConfig posts the legacy-named child-tab editor payload for one parent table.
 * The request configures reverse-FK "referring tabs" while preserving the established route contract.
 *
 * @param {SaveChildTabConfigRequest} request
 * @returns {Promise<SaveChildTabConfigResponse>}
 */
export async function saveChildTabConfig(request) {
    return stable_candidate_endpoint_router('saveChildTabConfig', {
        body_data: request,
    });
}

/** Save one sorting default owned by the authenticated user. */
export async function savePersonalDatasetSortDefault(request) {
    return stable_candidate_endpoint_router('savePersonalDatasetSortDefault', {
        body_data: request,
    });
}

/** Save an administrator-selected personal or site-wide sorting default. */
export async function saveDatasetSortDefault(request) {
    return stable_candidate_endpoint_router('saveDatasetSortDefault', {
        body_data: request,
    });
}

/** Load effective and reusable field collections for one dataset view. */
export async function getViewFieldSets(dataset, viewKey) {
    const query = new URLSearchParams({ dataset, view_key: viewKey });
    return stable_candidate_endpoint_router('getViewFieldSets', {
        url_params: `?${query.toString()}`,
    });
}

/** Save current visible fields as a named personal collection and activate it. */
export async function savePersonalViewFieldSet(request) {
    return stable_candidate_endpoint_router('savePersonalViewFieldSet', { body_data: request });
}

/** Activate an existing personal or shared collection for the current user. */
export async function assignPersonalViewFieldSet(request) {
    return stable_candidate_endpoint_router('assignPersonalViewFieldSet', { body_data: request });
}

/** Remove the current user's assignment so the site/default layer is inherited. */
export async function resetPersonalViewFieldSet(request) {
    return stable_candidate_endpoint_router('resetPersonalViewFieldSet', { body_data: request });
}

/** Delete one collection owned by the current user. */
export async function deletePersonalViewFieldSet(request) {
    return stable_candidate_endpoint_router('deletePersonalViewFieldSet', { body_data: request });
}

/** Save current fields as a shared collection and activate it as the site default. */
export async function saveSiteViewFieldSet(request) {
    return stable_candidate_endpoint_router('saveSiteViewFieldSet', { body_data: request });
}

/** Activate an existing shared collection as the administrator-managed site default. */
export async function assignSiteViewFieldSet(request) {
    return stable_candidate_endpoint_router('assignSiteViewFieldSet', { body_data: request });
}

/** Remove selected administrator-managed site or group assignments. */
export async function resetSharedViewFieldSet(request) {
    return stable_candidate_endpoint_router('resetSharedViewFieldSet', { body_data: request });
}

/** Delete one shared collection through the administrator-only route. */
export async function deleteSharedViewFieldSet(request) {
    return stable_candidate_endpoint_router('deleteSharedViewFieldSet', { body_data: request });
}

/**
 * stable_candidate_endpoint_router forwards one manifest-backed candidate route through the
 * generic pipeline without widening the typed stable allowlist.
 *
 * @template T
 * @param {string} route_name
 * @param {object} [options]
 * @returns {Promise<T>}
 */
async function stable_candidate_endpoint_router(route_name, options = {}) {
    const descriptor = getStableCandidateRouteDescriptor(route_name);
    if (!descriptor) {
        throw new Error(`Route "${route_name}" is outside the stable candidate API set`);
    }

    return routeThroughManifestBackedDescriptor(route_name, descriptor, options);
}

/**
 * routeTypedStableClientRequestThroughEndpointRouter keeps the generated stable client on the
 * existing API pipeline by translating its normalized request metadata back into endpoint_router.
 *
 * @param {import('../../generated/stable_api_client').StableApiClientRequestContext} request
 * @returns {Promise<unknown>}
 */
function routeTypedStableClientRequestThroughEndpointRouter(request) {
    const routerOptions = { method: request.method };
    if (request.body !== null && request.body !== undefined) {
        routerOptions.body_data = request.body;
    }

    return endpoint_router(request.routeName, routerOptions);
}

/**
 * routeThroughManifestBackedDescriptor applies manifest-backed method defaults and mismatch checks
 * before delegating the request to the generic endpoint router.
 *
 * @template T
 * @param {string} routeName
 * @param {{ methods?: readonly string[] }} descriptor
 * @param {object} [options]
 * @returns {Promise<T>}
 */
function routeThroughManifestBackedDescriptor(routeName, descriptor, options = {}) {
    const resolvedMethod = resolveManifestBackedRouteMethod(routeName, descriptor, options.method);
    const routerOptions = resolvedMethod
        ? { ...options, method: resolvedMethod }
        : { ...options };

    return /** @type {Promise<T>} */ (endpoint_router(routeName, routerOptions));
}

/**
 * resolveManifestBackedRouteMethod applies the manifest-backed default method for stable routes
 * and rejects explicit mismatches before the request reaches the generic pipeline.
 *
 * @param {string} routeName
 * @param {{ methods?: readonly string[] }} descriptor
 * @param {string | undefined} requestedMethod
 * @returns {string | undefined}
 */
function resolveManifestBackedRouteMethod(routeName, descriptor, requestedMethod) {
    const declaredMethods = Array.isArray(descriptor.methods) ? descriptor.methods : [];

    if (!requestedMethod) {
        if (declaredMethods.length === 1) {
            return declaredMethods[0];
        }
        return undefined;
    }

    const normalizedMethod = requestedMethod.toUpperCase();
    if (declaredMethods.length > 0 && !declaredMethods.includes(normalizedMethod)) {
        throw new Error(
            `Route "${routeName}" only allows method(s): ${declaredMethods.join(', ')}`
        );
    }

    return normalizedMethod;
}
