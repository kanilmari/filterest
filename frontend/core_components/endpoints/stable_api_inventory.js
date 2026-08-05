// stable_api_inventory.js
// Inventories the current typed stable API island plus the surrounding route categories.
// Bridges backend route manifest data and frontend callers with an audited, fully-covered map.
// Exists to keep Phase B route typing focused on auth/admin/permissions/maintenance endpoints only.

import {
    getBackendRouteManifestEntry,
    getPreferredBackendRouteScenario,
} from './backend_route_manifest_reader.js';

/**
 * @typedef {'public' | 'login_only' | 'admin' | 'default' | 'custom'} StableRouteAccessProfile
 */

/**
 * @typedef {object} ManifestBackedRouteDescriptor
 * @property {string} routeName
 * @property {string} handlerName
 * @property {string} backendPath
 * @property {StableRouteAccessProfile} accessProfile
 * @property {readonly string[]} availableScenarios
 * @property {readonly string[]} methods
 * @property {string | null} methodSource
 */

/**
 * @typedef {ManifestBackedRouteDescriptor & {
 *   requestShape: string,
 *   responseShape: string,
 *   whyStable: string,
 * }} StableApiRouteDescriptor
 */

const TYPED_STABLE_ROUTE_SPECS = Object.freeze({
    authAndPermissions: Object.freeze([
        {
            routeName: 'fetchAuthModes',
            handlerName: 'auth.GetAuthModesHandler',
            requestShape: 'GET',
            responseShape: 'AuthModesResponse',
            whyStable: 'Small startup contract with fixed button-state and registration fields.',
        },
        {
            routeName: 'fetchUserPermissions',
            handlerName: 'auth.UserPermissionsHandler',
            requestShape: 'GET',
            responseShape: 'UserPermissionsResponse',
            whyStable: 'Fixed array payload used to seed the frontend permission cache.',
        },
    ]),
    adminMaintenance: Object.freeze([
        {
            routeName: 'fkCacheTriggers',
            handlerName: 'system_table_tools.ListFKCacheTriggersHandler',
            requestShape: 'GET',
            responseShape: 'FKCacheTriggersResponse',
            whyStable: 'Admin maintenance report with explicit Go request/response structs already in place.',
        },
        {
            routeName: 'fkCacheRefresh',
            handlerName: 'system_table_tools.RefreshFKCacheHandler',
            requestShape: 'FKCacheRefreshRequest',
            responseShape: 'FKCacheRefreshResponse',
            whyStable: 'Admin maintenance action with explicit Go request/response structs already in place.',
        },
    ]),
});

const STABLE_CANDIDATE_ROUTE_SPECS = Object.freeze({
    adminConfiguration: Object.freeze([
        { routeName: 'getDatasetAliasManagement', handlerName: 'router.GetDatasetAliasManagementHandler' },
        { routeName: 'saveDatasetAliasManagement', handlerName: 'router.SaveDatasetAliasManagementHandler' },
        { routeName: 'getCardVisibility', handlerName: 'system_table_tools.GetCardVisibilityHandler' },
        { routeName: 'updateCardVisibility', handlerName: 'system_table_tools.UpdateCardVisibilityHandler' },
        { routeName: 'getDatasetHeaderConfig', handlerName: 'system_table_tools.GetDatasetHeaderConfigHandler' },
        { routeName: 'saveDatasetHeaderConfig', handlerName: 'system_table_tools.SaveDatasetHeaderConfigHandler' },
        { routeName: 'getChildTabConfig', handlerName: 'system_table_tools.GetChildTabConfigHandler' },
        { routeName: 'saveChildTabConfig', handlerName: 'system_table_tools.SaveChildTabConfigHandler' },
        { routeName: 'setCurrentProjectFolder', handlerName: 'dtt_system_table_folders.HandleSetCurrentProjectFolder' },
    ]),
    adminMaintenance: Object.freeze([
        { routeName: 'adminVersionInfo', handlerName: 'router.adminVersionInfoHandler' },
        { routeName: 'saveOpenAIAPIKey', handlerName: 'router.saveOpenAIAPIKeyHandler' },
        { routeName: 'checkDbConsistency', handlerName: 'system_table_tools.CheckDatabaseConsistencyHandler' },
        { routeName: 'fixDbConsistency', handlerName: 'system_table_tools.FixDatabaseConsistencyHandler' },
        { routeName: 'checkJsonColumns', handlerName: 'devtools.CheckJsonInTextColumnsHandler' },
        { routeName: 'checkMediaTables', handlerName: 'system_table_tools.CheckMediaTableFoldersHandler' },
        { routeName: 'archiveMediaTables', handlerName: 'system_table_tools.ArchiveMediaTableFoldersHandler' },
        { routeName: 'checkArchivedMediaTables', handlerName: 'system_table_tools.CheckArchivedMediaTableFoldersHandler' },
        { routeName: 'checkMediaRows', handlerName: 'system_table_tools.CheckMediaRowFoldersHandler' },
        { routeName: 'checkMediaSubfolders', handlerName: 'system_table_tools.CheckMediaSubfoldersHandler' },
        { routeName: 'fixMediaSubfolders', handlerName: 'system_table_tools.FixMediaSubfoldersHandler' },
        { routeName: 'pruneArchivedMediaTables', handlerName: 'system_table_tools.PruneArchivedMediaTableFoldersHandler' },
        { routeName: 'listColumnViewPresets', handlerName: 'system_table_tools.ListColumnViewPresetsHandler' },
        { routeName: 'saveColumnViewPreset', handlerName: 'system_table_tools.SaveColumnViewPresetHandler' },
        { routeName: 'deleteColumnViewPreset', handlerName: 'system_table_tools.DeleteColumnViewPresetHandler' },
        { routeName: 'getFilterbarSectionLayout', handlerName: 'system_table_tools.GetFilterbarSectionLayoutHandler' },
        { routeName: 'saveFilterbarSectionLayout', handlerName: 'system_table_tools.SaveFilterbarSectionLayoutHandler' },
        { routeName: 'updateTabOrder', handlerName: 'system_table_tools.UpdateTabOrderHandler' },
    ]),
    authAndUser: Object.freeze([
        { routeName: 'fetchUserProfile', handlerName: 'auth.UserProfileFetchHandler' },
        { routeName: 'updateUserProfile', handlerName: 'auth.UserProfileUpdateHandler' },
        { routeName: 'requestEmailChangeOTP', handlerName: 'auth.RequestEmailChangeOTPHandler' },
        { routeName: 'requestPasswordChangeOTP', handlerName: 'auth.RequestPasswordChangeOTPHandler' },
        { routeName: 'logout', handlerName: 'auth.LogoutHandler' },
        { routeName: 'resetSession', handlerName: 'e_sessions.ResetSessionHandler' },
        { routeName: 'checkFingerprint', handlerName: 'auth.CheckFingerprintHandler' },
    ]),
});

/** @type {Readonly<Record<string, readonly ManifestBackedRouteDescriptor[]>>} */
export const STABLE_CANDIDATE_ROUTE_DESCRIPTORS = Object.freeze(
    Object.fromEntries(
        Object.entries(STABLE_CANDIDATE_ROUTE_SPECS).map(([groupName, routeSpecs]) => [
            groupName,
            Object.freeze(routeSpecs.map((routeSpec) => buildManifestBackedRouteDescriptor(routeSpec))),
        ])
    )
);

/** @type {Readonly<Record<string, readonly StableApiRouteDescriptor[]>>} */
export const TYPED_STABLE_ROUTE_GROUPS = Object.freeze(
    Object.fromEntries(
        Object.entries(TYPED_STABLE_ROUTE_SPECS).map(([groupName, routeSpecs]) => [
            groupName,
            Object.freeze(routeSpecs.map((routeSpec) => buildTypedStableRouteDescriptor(routeSpec))),
        ])
    )
);

/** @type {Readonly<Record<string, readonly string[]>>} */
export const STABLE_CANDIDATE_ROUTE_GROUPS = Object.freeze(
    Object.fromEntries(
        Object.entries(STABLE_CANDIDATE_ROUTE_DESCRIPTORS).map(([groupName, routeDescriptors]) => [
            groupName,
            Object.freeze(routeDescriptors.map((routeDescriptor) => routeDescriptor.routeName)),
        ])
    )
);

/** @type {Readonly<Record<string, readonly string[]>>} */
export const SUPPORTING_ROUTE_GROUPS = Object.freeze({
    browserBootstrap: Object.freeze([
        'productIdentity',
        'fetchCsrfToken',
        'fetchSessionInfo',
        'fetchConfig',
        'login',
        'fetchAboutContent',
    ]),
    queenAndAgentTools: Object.freeze([
        'queenRuns',
        'queenSessions',
        'queenSession',
        'queenSessionMessage',
        'queenSessionStream',
        'stopQueenSession',
        'queenTranscript',
        'queenTranscriptStream',
    ]),
    translationAndLanguageTools: Object.freeze([
        'translations',
        'getLangKeyTranslations',
        'updateLangKey',
        'devAiTranslateSingle',
    ]),
    exportsAndDiagnostics: Object.freeze([
        'exportTableCsv',
        'importTableCsv',
        'logClientError',
    ]),
});

/** @type {Readonly<Record<string, readonly string[]>>} */
export const DYNAMIC_ROUTE_GROUPS = Object.freeze({
    datasetReads: Object.freeze([
        'fetchContentTables',
        'fetchDynamicChildren',
        'fetchComments',
        'createComment',
        'deleteComment',
        'fetchCommentCounts',
        'fetchEmptyRows',
        'fetchTreeData',
        'fetchViewData',
        'datasetAliases',
        'datasetPermissions',
        'datasetNames',
        'getResults',
        'getFilterOptions',
        'getIntelligentResults',
        'getResultsVector',
        'getRowCount',
        'getColumns',
        'getOneToMany',
        'getManyToMany',
        'referencedData',
        'datasetColumns',
        'checkTableRight',
        'checkTableRights',
        'checkTableRightsMulti',
        'getTaskTodoProgress',
    ]),
    datasetWritesAndSchema: Object.freeze([
        'fetchForeignKeys',
        'addForeignKey',
        'deleteForeignKey',
        'addRowMultipart',
        'deleteRows',
        'updateRow',
        'createDataset',
        'dropDataset',
        'modifyColumns',
        'updateOids',
        'createTrigger',
        'updateFolder',
        'updateTableFolder',
        'createFolder',
        'deleteFolder',
        'renameTreeNode',
        'generateTranslations',
        'fixTranslations',
        'enableImageAssetLinking',
        'disableImageAssetLinking',
        'removeImageAssetLinking',
        'imageAssetLinkingStatus',
        'assetLinkingStatus',
        'updateImageAssetLinking',
        'enableAttachmentAssetLinking',
        'disableAttachmentAssetLinking',
        'removeAttachmentAssetLinking',
        'attachmentAssetLinkingStatus',
    ]),
    aiAndStreaming: Object.freeze([
        'aiChatCapabilities',
        'aiChatQuery',
        'aiChatCodexQuery',
        'aiChatConversation',
        'geocodeAddress',
        'embeddingDatasets',
        'openaiEmbedStream',
        'refreshLangEmbeddings',
        'countLangEmbeddings',
        'getIntelligentResultsStream',
        'textIndexStatus',
        'rebuildSearchVectors',
    ]),
});

export const TYPED_STABLE_ROUTE_NAMES = Object.freeze(
    Object.values(TYPED_STABLE_ROUTE_GROUPS)
        .flat()
        .map((descriptor) => descriptor.routeName)
);

export const STABLE_CANDIDATE_ROUTE_NAMES = Object.freeze(
    Object.values(STABLE_CANDIDATE_ROUTE_GROUPS).flat()
);

export const DYNAMIC_ROUTE_NAMES = Object.freeze(
    Object.values(DYNAMIC_ROUTE_GROUPS).flat()
);

export const SUPPORTING_ROUTE_NAMES = Object.freeze(
    Object.values(SUPPORTING_ROUTE_GROUPS).flat()
);

export const CLASSIFIED_ROUTE_NAMES = Object.freeze(Array.from(new Set([
    ...TYPED_STABLE_ROUTE_NAMES,
    ...STABLE_CANDIDATE_ROUTE_NAMES,
    ...DYNAMIC_ROUTE_NAMES,
    ...SUPPORTING_ROUTE_NAMES,
])));

/**
 * Returns whether a route belongs to the current typed stable allowlist.
 *
 * @param {string} routeName
 * @returns {boolean}
 */
export function isTypedStableRoute(routeName) {
    return TYPED_STABLE_ROUTE_NAMES.includes(routeName);
}

/**
 * Returns the typed stable route descriptor, or null when the route is outside the allowlist.
 *
 * @param {string} routeName
 * @returns {StableApiRouteDescriptor | null}
 */
export function getTypedStableRouteDescriptor(routeName) {
    for (const group of Object.values(TYPED_STABLE_ROUTE_GROUPS)) {
        for (const descriptor of group) {
            if (descriptor.routeName === routeName) {
                return descriptor;
            }
        }
    }

    return null;
}

/**
 * Returns the manifest-backed candidate descriptor, or null when the route is outside the current candidate set.
 *
 * @param {string} routeName
 * @returns {ManifestBackedRouteDescriptor | null}
 */
export function getStableCandidateRouteDescriptor(routeName) {
    for (const group of Object.values(STABLE_CANDIDATE_ROUTE_DESCRIPTORS)) {
        for (const descriptor of group) {
            if (descriptor.routeName === routeName) {
                return descriptor;
            }
        }
    }

    return null;
}

/**
 * @param {{ routeName: string, handlerName: string }} routeSpec
 * @returns {ManifestBackedRouteDescriptor}
 */
function buildManifestBackedRouteDescriptor(routeSpec) {
    const manifestRouteDescriptor = getBackendRouteManifestEntry(routeSpec.handlerName);
    const preferredScenarioDescriptor = getPreferredBackendRouteScenario(manifestRouteDescriptor);

    return Object.freeze({
        routeName: routeSpec.routeName,
        handlerName: routeSpec.handlerName,
        backendPath: manifestRouteDescriptor.path_pattern,
        accessProfile: preferredScenarioDescriptor.profile_name,
        availableScenarios: Object.freeze(
            manifestRouteDescriptor.scenarios.map((scenarioDescriptor) => scenarioDescriptor.name)
        ),
        methods: Object.freeze([...(manifestRouteDescriptor.methods || [])]),
        methodSource: manifestRouteDescriptor.method_source || null,
    });
}

/**
 * @param {{ routeName: string, handlerName: string, requestShape: string, responseShape: string, whyStable: string }} routeSpec
 * @returns {StableApiRouteDescriptor}
 */
function buildTypedStableRouteDescriptor(routeSpec) {
    return Object.freeze({
        ...buildManifestBackedRouteDescriptor(routeSpec),
        requestShape: routeSpec.requestShape,
        responseShape: routeSpec.responseShape,
        whyStable: routeSpec.whyStable,
    });
}
