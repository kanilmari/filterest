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
 * @typedef {object} ColumnViewPresetRow
 * @property {number} id
 * @property {string} preset_name
 * @property {Record<string, boolean>} [hidden_columns]
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
 * @typedef {object} SaveColumnViewPresetRequest
 * @property {string} table_name
 * @property {string} preset_name
 * @property {Record<string, boolean>} hidden_columns
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
 * fetchAdminVersionInfo returns the protected running product/database versions.
 *
 * @param {object} [options]
 * @returns {Promise<{
 *   product_name: string,
 *   app_version: string,
 *   db_version: string,
 *   required_db_version: string,
 *   db_compatible: boolean
 * }>}
 */
export async function fetchAdminVersionInfo(options = {}) {
    return stable_candidate_endpoint_router('adminVersionInfo', options);
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

/**
 * listColumnViewPresets returns the shared preset list for one table.
 *
 * @param {string} tableName
 * @returns {Promise<ColumnViewPresetRow[] | { presets?: ColumnViewPresetRow[] }>}
 */
export async function listColumnViewPresets(tableName) {
    return stable_candidate_endpoint_router('listColumnViewPresets', {
        url_params: tableName,
    });
}

/**
 * saveColumnViewPreset posts a named column-view preset.
 *
 * @param {SaveColumnViewPresetRequest} request
 * @returns {Promise<unknown>}
 */
export async function saveColumnViewPreset(request) {
    return stable_candidate_endpoint_router('saveColumnViewPreset', {
        body_data: request,
    });
}

/**
 * deleteColumnViewPreset removes one named column-view preset.
 *
 * @param {{ id: number }} request
 * @returns {Promise<unknown>}
 */
export async function deleteColumnViewPreset(request) {
    return stable_candidate_endpoint_router('deleteColumnViewPreset', {
        body_data: request,
    });
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
