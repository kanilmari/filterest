// api_pipeline.js
// Runs the ordered frontend pipeline for API requests.
// Bridges endpoint_router callers and the staged fetch, auth, and error handlers.
// Exists to centralise cross-cutting request behavior instead of scattering it across callers.

import { createPipeline, createStage } from './frontend_pipeline.js';
import { requestLoginRedirect } from '../auth/login_redirect_handler.js';
import { showAccessDeniedToast } from '../../reusable_components/notifications/toast_notification_printer.js';
import {
    isMutatingMethod,
    resolveEndpointUrl,
    buildFetchOptions,
    isAuthFailure403,
    isDataRequestAnsweredWithPage,
    isCsrfFailureResponse,
    createAuthError,
    createRateLimitError,
    createServiceUnavailableError,
    stripAnsiCodes,
    shouldThrottleRateLimitToast,
    resolveFailureNotice,
} from './api_pipeline_helpers.js';
import { getBackendRoutePathByHandler } from '../endpoints/backend_route_manifest_reader.js';
import { markCallerOwnsFailureNotice } from '../error_and_status_handling/error_monitor_handler_helpers.js';
import {
    isExpectedNetworkAbort,
    showRequestFailureNotice,
} from '../error_and_status_handling/request_failure_notice.js';

// ==========================================
// Endpoint Map
// ==========================================

/**
 * MANIFEST_BACKED_ENDPOINT_ROUTE_HANDLERS maps logical route names to backend handlers.
 * Backend URL paths are derived from frontend/generated/backend_route_manifest.json.
 */
export const MANIFEST_BACKED_ENDPOINT_ROUTE_HANDLERS = Object.freeze({
    fetchContentTables: 'system_table_tools.GetGroupedTables',
    fetchForeignKeys: 'dtt_foreign_keys.GetForeignKeys',
    addForeignKey: 'dtt_foreign_keys.AddForeignKeyHandler',
    deleteForeignKey: 'dtt_foreign_keys.DeleteForeignKeyHandler',
    fetchDynamicChildren: 'dtt_1_row_read.GetDynamicChildItemsHandler',
    fetchComments: 'dtt_1_row_read.CommentListHandler',
    createComment: 'dtt_1_row_read.CommentCreateHandler',
    deleteComment: 'dtt_1_row_read.CommentDeleteHandler',
    fetchCommentCounts: 'dtt_1_row_read.CommentCountHandler',
    fetchAuthModes: 'auth.GetAuthModesHandler',
    productIdentity: 'product_identity.Handler',
    adminVersionInfo: 'router.adminVersionInfoHandler',
    fetchUserPermissions: 'auth.UserPermissionsHandler',
    fetchCsrfToken: 'auth.CSRFTokenHandler',
    fetchSessionInfo: 'devtools.SessionHandler',
    fetchUserProfile: 'auth.UserProfileFetchHandler',
    updateUserProfile: 'auth.UserProfileUpdateHandler',
    requestEmailChangeOTP: 'auth.RequestEmailChangeOTPHandler',
    requestPasswordChangeOTP: 'auth.RequestPasswordChangeOTPHandler',
    fetchEmptyRows: 'system_table_tools.GetEmptyRowsHandler',
    checkMediaTables: 'system_table_tools.CheckMediaTableFoldersHandler',
    archiveMediaTables: 'system_table_tools.ArchiveMediaTableFoldersHandler',
    checkArchivedMediaTables: 'system_table_tools.CheckArchivedMediaTableFoldersHandler',
    pruneArchivedMediaTables: 'system_table_tools.PruneArchivedMediaTableFoldersHandler',
    checkMediaRows: 'system_table_tools.CheckMediaRowFoldersHandler',
    checkMediaSubfolders: 'system_table_tools.CheckMediaSubfoldersHandler',
    fixMediaSubfolders: 'system_table_tools.FixMediaSubfoldersHandler',
    exportTableCsv: 'devtools.ExportTableCSVHandler',
    importTableCsv: 'devtools.ImportTableCSVHandler',
    updateFolder: 'dtt_system_table_folders.HandleUpdateFolder',
    updateTableFolder: 'dtt_system_table_folders.HandleUpdateTableFolder',
    setCurrentProjectFolder: 'dtt_system_table_folders.HandleSetCurrentProjectFolder',
    createFolder: 'dtt_system_table_folders.HandleCreateFolder',
    deleteFolder: 'dtt_system_table_folders.HandleDeleteFolder',
    renameTreeNode: 'dtt_system_table_folders.HandleRenameTreeNode',
    getLangKeyTranslations: 'lang.GetLangKeyTranslationsHandler',
    updateLangKey: 'lang.UpdateLangKeyHandler',
    devAiTranslateSingle: 'lang.AiTranslateSingleHandler',
    fetchTreeData: 'vanilla_tree.GetTreeDataHandler',
    fetchViewData: 'vanilla_tree.GetViewDataHandler',
    dropDataset: 'dtt_3_table_delete.DropTableHandler',
    modifyColumns: 'dtt_crud_workflows.ModifyColumnsHandler',
    adminDatasetUiVisibility: 'system_table_tools.AdminDatasetUIVisibilityHandler',
    updateOids: 'system_table_tools.HandleUpdateOidsAndTableNames',
    generateTranslations: 'lang.GenerateTranslationsHandler',
    fixTranslations: 'lang.FixTableTranslationsHandler',
    datasetPermissions: 'backend.PermissionsHandler',
    addRowMultipart: 'dtt_1_row_create.AddRowMultipartHandlerWrapper',
    geocodeAddress: 'dtt_1_row_create.GeocodeAddressHandler',
    deleteRows: 'dtt_1_row_delete.DeleteRowsHandlerWrapper',
    createDataset: 'dtt_crud_workflows.CreateTableHandler',
    datasetAliases: 'router.GetDatasetAliasesHandler',
    getDatasetAliasManagement: 'router.GetDatasetAliasManagementHandler',
    saveDatasetAliasManagement: 'router.SaveDatasetAliasManagementHandler',
    datasetNames: 'dtt_foreign_keys.GetTableNamesHandler',
    embeddingDatasets: 'ai_features.GetEmbeddingDatasetsHandler',
    embeddingSourcePolicy: 'ai_features.ExternalEmbeddingSourcePolicyHandler',
    publicUiLanguages: 'lang.GetPublicUILanguagesHandler',
    adminUiLanguages: 'lang.AdminUILanguagesHandler',
    adminUserAuthentication: 'auth.AdminUserAuthenticationHandler',
    adminLangKey: 'lang.AdminLangKeyHandler',
    adminSymbols: 'symbol_registry.AdminHandler',
    adminUiFeatureFlags: 'system_table_tools.GetAdminUIFeatureFlagsHandler',
    sitePresentationSettings: 'system_table_tools.GetSitePresentationSettingsHandler',
    adminSitePresentationSettings: 'system_table_tools.AdminSitePresentationSettingsHandler',
    adminRowGroups: 'system_table_tools.AdminRowGroupsHandler',
    adminRowGroupMemberships: 'system_table_tools.AdminRowGroupMembershipsHandler',
    adminRowAccessRules: 'system_table_tools.AdminRowAccessRulesHandler',
    mediaLibraryList: 'media_library.ListHandler',
    mediaLibraryAttach: 'media_library.AttachHandler',
    mediaLibraryDetach: 'media_library.DetachHandler',
    imageSourcePickerProviders: 'image_source_picker.ProvidersHandler',
    imageSourcePickerResolve: 'image_source_picker.ResolveHandler',
    imageSourcePickerFile: 'image_source_picker.FileHandler',
    createTrigger: 'dtt_triggers.CreateTriggerHandler',
    updateRow: 'dtt_1_row_update.UpdateRowHandlerWrapper',
    getColumns: 'dtt_1_row_create.GetAddRowColumnsHandlerWrapper',
    getOneToMany: 'dtt_1_row_create.GetOneToManyRelationsHandlerWrapper',
    getManyToMany: 'dtt_1_row_create.GetManyToManyTablesHandlerWrapper',
    referencedData: 'dtt_1_row_create.GetReferencedTableData',
    datasetColumns: 'dtt_2_column_crud.GetTableColumnsHandler',
    translations: 'lang.GetTranslationsHandler',
    getRowCount: 'dtt_1_row_read.GetRowCountHandlerWrapper',
    getIntelligentResults: 'dtt_1_row_read.GetIntelligentResultsHandlerWrapper',
    getResultsVector: 'dtt_1_row_read.GetResultsVector',
    resetSession: 'e_sessions.ResetSessionHandler',
    checkFingerprint: 'auth.CheckFingerprintHandler',
    getResults: 'dtt_1_row_read.GetResultsHandlerWrapper',
    getFilterOptions: 'dtt_1_row_read.GetFilterOptionsHandler',
    aiChatCapabilities: 'dtt_1_row_read.FilterbarAICapabilitiesHandler',
    aiChatQuery: 'dtt_1_row_read.FilterbarAIQueryHandler',
    aiChatCodexQuery: 'dtt_1_row_read.FilterbarAICodexQueryHandler',
    aiChatConversation: 'dtt_1_row_read.FilterbarAIConversationHandler',
    aiChatSiteAssistantApproval: 'dtt_1_row_read.SiteAssistantApprovalHandler',
    aiChatAttachment: 'dtt_1_row_read.ChatAttachmentHandler',
    saveOpenAIAPIKey: 'router.saveOpenAIAPIKeyHandler',
    saveProviderAPIKey: 'router.saveProviderAPIKeyHandler',
    openaiEmbedStream: 'ai_features.EmbeddingStreamHandler',
    refreshLangEmbeddings: 'ai_features.RefreshLangEmbeddingsHandler',
    countLangEmbeddings: 'ai_features.CountLangEmbeddingsHandler',
    checkTableRight: 'auth.CheckTableRightHandler',
    checkTableRights: 'auth.CheckTableRightsHandler',
    checkTableRightsMulti: 'auth.CheckTableRightsMultiHandler',
    logout: 'auth.LogoutHandler',
    textIndexStatus: 'dtt_search_vectors.TextIndexStatusHandler',
    rebuildSearchVectors: 'dtt_search_vectors.RebuildSearchVectorHandler',
    checkJsonColumns: 'devtools.CheckJsonInTextColumnsHandler',
    checkDbConsistency: 'system_table_tools.CheckDatabaseConsistencyHandler',
    fixDbConsistency: 'system_table_tools.FixDatabaseConsistencyHandler',
    fkCacheTriggers: 'system_table_tools.ListFKCacheTriggersHandler',
    fkCacheRefresh: 'system_table_tools.RefreshFKCacheHandler',
    getCardVisibility: 'system_table_tools.GetCardVisibilityHandler',
    updateCardVisibility: 'system_table_tools.UpdateCardVisibilityHandler',
    getDatasetHeaderConfig: 'system_table_tools.GetDatasetHeaderConfigHandler',
    saveDatasetHeaderConfig: 'system_table_tools.SaveDatasetHeaderConfigHandler',
    getViewFieldSets: 'system_table_tools.GetViewFieldSetsHandler',
    getArticleSectionDefaults: 'system_table_tools.GetArticleSectionDefaultsHandler',
    saveArticleSectionDefaults: 'system_table_tools.SaveArticleSectionDefaultsHandler',
    savePersonalViewFieldSet: 'system_table_tools.SavePersonalViewFieldSetHandler',
    assignPersonalViewFieldSet: 'system_table_tools.AssignPersonalViewFieldSetHandler',
    resetPersonalViewFieldSet: 'system_table_tools.ResetPersonalViewFieldSetHandler',
    deletePersonalViewFieldSet: 'system_table_tools.DeletePersonalViewFieldSetHandler',
    saveSiteViewFieldSet: 'system_table_tools.SaveSiteViewFieldSetHandler',
    assignSiteViewFieldSet: 'system_table_tools.AssignSiteViewFieldSetHandler',
    resetSharedViewFieldSet: 'system_table_tools.ResetSharedViewFieldSetHandler',
    deleteSharedViewFieldSet: 'system_table_tools.DeleteSharedViewFieldSetHandler',
    getFilterbarSectionLayout: 'system_table_tools.GetFilterbarSectionLayoutHandler',
    saveFilterbarSectionLayout: 'system_table_tools.SaveFilterbarSectionLayoutHandler',
    getDatasetSortDefault: 'system_table_tools.GetDatasetSortDefaultHandler',
    savePersonalDatasetSortDefault: 'system_table_tools.SavePersonalDatasetSortDefaultHandler',
    saveDatasetSortDefault: 'system_table_tools.SaveDatasetSortDefaultHandler',
    getTaskTodoProgress: 'system_table_tools.GetTaskTodoProgressHandler',
    getChildTabConfig: 'system_table_tools.GetChildTabConfigHandler',
    saveChildTabConfig: 'system_table_tools.SaveChildTabConfigHandler',
    updateTabOrder: 'system_table_tools.UpdateTabOrderHandler',
    login: 'auth.LoginHandler',
    fetchAboutContent: 'system_table_tools.GetAboutRowHandler',
    logClientError: 'devtools.LogClientError',
    enableImageAssetLinking: 'dtt_asset_linking.EnableImageAssetLinkingHandler',
    disableImageAssetLinking: 'dtt_asset_linking.DisableImageAssetLinkingHandler',
    removeImageAssetLinking: 'dtt_asset_linking.RemoveImageAssetLinkingHandler',
    imageAssetLinkingStatus: 'dtt_asset_linking.GetImageAssetLinkingStatusHandler',
    assetLinkingStatus: 'dtt_asset_linking.GetAssetLinkingStatusHandler',
    updateImageAssetLinking: 'dtt_asset_linking.UpdateImageAssetLinkingHandler',
    enableAttachmentAssetLinking: 'dtt_asset_linking.EnableAttachmentLinkingHandler',
    disableAttachmentAssetLinking: 'dtt_asset_linking.DisableAttachmentLinkingHandler',
    removeAttachmentAssetLinking: 'dtt_asset_linking.RemoveAttachmentLinkingHandler',
    attachmentAssetLinkingStatus: 'dtt_asset_linking.GetAttachmentLinkingStatusHandler',
});

/**
 * EXPLICIT_ENDPOINT_ROUTES holds frontend-only or route-variant URLs not represented as
 * exact backend route manifest entries.
 */
export const EXPLICIT_ENDPOINT_ROUTES = Object.freeze({
    getIntelligentResultsStream: '/api/get-intelligent-results?stream=1',
    fetchConfig: '/config.json',
});

export const MANIFEST_BACKED_ENDPOINT_ROUTE_NAMES = Object.freeze(
    Object.keys(MANIFEST_BACKED_ENDPOINT_ROUTE_HANDLERS)
);

export const EXPLICIT_ENDPOINT_ROUTE_NAMES = Object.freeze(
    Object.keys(EXPLICIT_ENDPOINT_ROUTES)
);

/**
 * buildManifestBackedEndpointMap resolves route names to backend paths through
 * the generated route manifest.
 *
 * @param {Readonly<Record<string, string>>} routeHandlers
 * @returns {Record<string, string>}
 */
function buildManifestBackedEndpointMap(routeHandlers) {
    return Object.fromEntries(
        Object.entries(routeHandlers).map(([routeName, handlerName]) => [
            routeName,
            getBackendRoutePathByHandler(handlerName),
        ])
    );
}

/**
 * endpoint_map maps logical route names to URLs used by the API pipeline.
 * Manifest-backed routes derive URLs from backend handlers; explicit exceptions
 * cover frontend-static paths and query-param route variants.
 */
const endpoint_map = {
    ...buildManifestBackedEndpointMap(MANIFEST_BACKED_ENDPOINT_ROUTE_HANDLERS),
    ...EXPLICIT_ENDPOINT_ROUTES,
};

/**
 * ENDPOINT_ROUTE_NAMES exposes the current endpoint_map keyspace for inventory/tests.
 * Keep route classification drift checks anchored to this single source of truth.
 */
export const ENDPOINT_ROUTE_NAMES = Object.freeze(Object.keys(endpoint_map));

/**
 * registerEndpointRoute lets optional source-level extensions add API routes
 * before calling endpoint_router without baking private route URLs into public code.
 *
 * @param {string} routeName
 * @param {string} routeUrl
 */
export function registerEndpointRoute(routeName, routeUrl) {
    if (!routeName || typeof routeName !== 'string') {
        throw new Error('registerEndpointRoute requires a route name');
    }
    if (!routeUrl || typeof routeUrl !== 'string' || !routeUrl.startsWith('/')) {
        throw new Error(`registerEndpointRoute requires an absolute route URL for ${routeName}`);
    }
    if (endpoint_map[routeName] && endpoint_map[routeName] !== routeUrl) {
        throw new Error(`endpoint route "${routeName}" is already registered`);
    }
    endpoint_map[routeName] = routeUrl;
}

/**
 * Returns the URL for a given route name, or empty string if not found.
 *
 * @param {string} routeName
 * @returns {string}
 */
export function getEndpointUrl(routeName) {
    return endpoint_map[routeName] || '';
}

// ==========================================
// CSRF Token Cache
// ==========================================

let _csrfTokenCache = null;

/**
 * Fetches and caches the CSRF token from csrf-token endpoint.
 * Subsequent calls return the cached token without a network request.
 *
 * @returns {Promise<string|null>}
 */
// PIPELINE_EXCEPTION: api_pipeline.js implements the pipeline itself; this fetch bootstraps the CSRF token
// before any pipeline run is possible. See docs/instructions_and_documentation/PIPELINE_EXCEPTIONS.md.
export async function ensureCsrfToken({ forceRefresh = false } = {}) {
    if (forceRefresh) {
        _csrfTokenCache = null;
    }
    if (_csrfTokenCache) return _csrfTokenCache;
    try {
        const res = await fetch(endpoint_map.fetchCsrfToken, { credentials: 'include' });
        if (res.ok) {
            const data = await res.json();
            _csrfTokenCache = data.csrf_token || null;
        }
    } catch (err) {
        console.warn('CSRF token fetch failed', err);
    }
    return _csrfTokenCache;
}

// ==========================================
// Stage Implementations
// ==========================================

/**
 * resolveUrlStage — resolves the route name to a full URL.
 * Throws immediately for unknown route names (programming error).
 */
async function resolveUrlStage(ctx) {
    ctx.resolvedUrl = resolveEndpointUrl(ctx.routeName, ctx.urlParams, endpoint_map);
}

/**
 * buildFetchOptionsStage — constructs the fetch options object from context.
 * Sets method, default Content-Type, credentials, and body.
 * The pipeline owns the failure notice of every request it sends: its own
 * stages show it, or its caller does (suppressErrorToast). The options are
 * therefore always marked, so the global fetch monitor never adds a second
 * notice for a server or network failure (error_monitor_handler.js).
 */
async function buildFetchOptionsStage(ctx) {
    ctx.fetchOptions = buildFetchOptions({
        method: ctx.method,
        headers: ctx.headers,
        bodyData: ctx.bodyData,
    });
    if (ctx.signal !== undefined) ctx.fetchOptions.signal = ctx.signal;
    markCallerOwnsFailureNotice(ctx.fetchOptions);
}

/**
 * csrfStage — injects the X-CSRF-Token header for state-mutating requests.
 * Fetches and caches the token from csrf-token endpoint on first use.
 */
async function csrfStage(ctx) {
    if (!isMutatingMethod(ctx.fetchOptions.method)) return;
    const token = await ensureCsrfToken();
    if (token) {
        ctx.fetchOptions.headers['X-CSRF-Token'] = token;
    }
}

/**
 * fingerprintStage — previously injected the X-Fingerprint header from the fingerprint cookie.
 *
 * The fingerprint cookie is now HttpOnly so JS cannot read it. The cookie is
 * sent automatically by the browser on every request — no client-side injection
 * is needed. This stage is kept as a no-op for pipeline documentation purposes.
 *
 * Non-enforced (required=false): a stage error never aborts the request.
 */
 
async function fingerprintStage(_ctx) {
    // Fingerprint cookie is HttpOnly — sent automatically by the browser.
    // No client-side header injection required.
}

/**
 * executeStage — performs the actual fetch call and stores the Response.
 */
async function executeStage(ctx) {
    ctx.response = await fetchReportingNetworkFailure(ctx);
}

/**
 * Sends the request once. When it never reaches the service, the reader gets
 * the translated network notice (unless the caller shows its own, or the
 * request was cancelled on purpose) and the console gets the browser's error.
 */
// PIPELINE_EXCEPTION: This is the pipeline's own execute path — the direct fetch() here IS the pipeline.
// See docs/instructions_and_documentation/PIPELINE_EXCEPTIONS.md.
async function fetchReportingNetworkFailure(ctx) {
    try {
        return await fetch(ctx.resolvedUrl, ctx.fetchOptions);
    } catch (error) {
        if (!isExpectedNetworkAbort(error, ctx.fetchOptions)) {
            console.error(`[api_pipeline] ${ctx.routeName}: the request did not reach the service`, error);
            if (!ctx.suppressErrorToast) showRequestFailureNotice('network_error_notice');
        }
        throw error;
    }
}

/**
 * csrfRecoveryStage — retries one mutating request when the backend explicitly
 * reports a CSRF mismatch/missing-token 403. This recovers from stale token
 * caches after session-cookie churn without masking normal permission denials.
 */
async function csrfRecoveryStage(ctx) {
    if (!isMutatingMethod(ctx.fetchOptions.method)) return;
    if (ctx.response.status !== 403 || ctx.csrfRetryAttempted) return;

    let bodyText = '';
    try {
        bodyText = await ctx.response.clone().text();
    } catch (err) {
        console.warn('[api_pipeline] csrfRecoveryStage: failed to inspect 403 response body:', err);
        return;
    }

    if (!isCsrfFailureResponse(bodyText)) {
        return;
    }

    const previousToken = ctx.fetchOptions.headers['X-CSRF-Token'] || '';
    const refreshedToken = await ensureCsrfToken({ forceRefresh: true });
    if (!refreshedToken || refreshedToken === previousToken) {
        return;
    }

    ctx.fetchOptions.headers['X-CSRF-Token'] = refreshedToken;
    ctx.csrfRetryAttempted = true;
    ctx.response = await fetchReportingNetworkFailure(ctx);
}

/**
 * authRedirectStage — decides when an answer means "your sign-in has ended".
 * 401 always redirects to login (unless ctx.suppressAuthRedirect is set).
 * 403 redirects only when the backend sets auth_failure=true (via RespondWithAuthFailure).
 * All other 403s remain permission denials, independent of cached login state.
 * The error stage shows localized permission feedback unless the caller owns it.
 *
 * A data request that followed a redirect onto a page means the same thing. The
 * server is not supposed to answer that way — see
 * app/backend/core_components/session_expiry/session_expiry_responder.go — but if
 * it ever does, the browser follows the redirect silently and the caller would
 * receive a login page with a success status. Treating that as an ended sign-in
 * is what keeps the person from being left with an interface that has nothing in
 * it and no explanation. Callers that asked for the raw response own the answer
 * themselves, so they are left alone.
 *
 * When ctx.suppressAuthRedirect is true, the stage still detects auth failures
 * and aborts the pipeline, but does NOT navigate to /login. This allows callers
 * (e.g. guest init sequence) to catch the error and provide graceful fallbacks.
 */
async function authRedirectStage(ctx) {
    const status = ctx.response.status;
    if (!ctx.returnResponse && !ctx.stream && isDataRequestAnsweredWithPage(ctx.response)) {
        console.warn(`[api_pipeline] ${ctx.routeName}: answered with a page, treating it as an ended sign-in`);
        if (!ctx.suppressAuthRedirect) {
            requestLoginRedirect({ authenticationFailure: true });
        }
        return {
            abort: true,
            reason: 'auth_redirect',
            error: createAuthError(status, ctx.routeName),
        };
    }
    if (status === 401) {
        if (!ctx.suppressAuthRedirect) {
            requestLoginRedirect({ authenticationFailure: true });
        }
        return {
            abort: true,
            reason: 'auth_redirect',
            error: createAuthError(status, ctx.routeName),
        };
    }
    if (status !== 403) return;

    let bodyText = '';
    try {
        const responseClone = ctx.response.clone();
        bodyText = await responseClone.text();
    } catch (err) {
        console.warn('[api_pipeline] authRedirectStage: failed to inspect 403 response body:', err);
    }

    if (isAuthFailure403(bodyText)) {
        if (!ctx.suppressAuthRedirect) {
            requestLoginRedirect({ authenticationFailure: true });
        }
        return {
            abort: true,
            reason: 'auth_redirect',
            error: createAuthError(status, ctx.routeName),
        };
    }


}

/**
 * rateLimitHandlerStage — throws a typed RateLimitError on 429 responses.
 * Shows a translated warning automatically so callers don't need to handle display.
 * Consolidates multiple simultaneous 429s into a single toast to avoid
 * flooding the user with one notification per blocked API call.
 * Callers can catch err.isRateLimited === true to add custom backoff logic.
 */
let _rateLimitLastToastTime = 0;
const _RATE_LIMIT_TOAST_WINDOW_MS = 5000;

async function rateLimitHandlerStage(ctx) {
    if (ctx.response.status !== 429) return;

    const now = Date.now();
    if (!ctx.suppressErrorToast && shouldThrottleRateLimitToast(_rateLimitLastToastTime, _RATE_LIMIT_TOAST_WINDOW_MS, now)) {
        _rateLimitLastToastTime = now;
        showRequestFailureNotice('rate_limit_notice', { level: 'warning', duration: 6000 });
    }
    console.debug(`[api_pipeline] 429 rate-limited: ${ctx.routeName}`);

    throw createRateLimitError(ctx.routeName);
}

/**
 * serviceUnavailableHandlerStage — converts maintenance/drain responses into one
 * typed retryable error and a bounded, translated, non-technical warning.
 * It is the only notice a 503 gets: the server-error notice is for other 5xx.
 */
let _serviceUnavailableLastToastTime = 0;
const _SERVICE_UNAVAILABLE_TOAST_WINDOW_MS = 5000;

async function serviceUnavailableHandlerStage(ctx) {
    if (ctx.response.status !== 503) return;

    const now = Date.now();
    if (!ctx.suppressErrorToast && shouldThrottleRateLimitToast(
        _serviceUnavailableLastToastTime,
        _SERVICE_UNAVAILABLE_TOAST_WINDOW_MS,
        now
    )) {
        _serviceUnavailableLastToastTime = now;
        showRequestFailureNotice('service_unavailable_notice', { level: 'warning', duration: 7000 });
    }
    console.warn(`[api_pipeline] ${ctx.routeName}: service unavailable (503)`);

    throw createServiceUnavailableError(ctx.routeName);
}

/**
 * errorHandlerStage — throws for all non-ok responses not handled by prior stages.
 * Shows one translated notice automatically so callers don't need to handle display:
 * the permission notice for a 403, and otherwise the sentence resolveFailureNotice
 * picks, with the status code. The route and the server's own text are technical
 * detail for the console (ANSI colour codes stripped) and for the thrown error,
 * so callers can still catch it for custom recovery logic.
 * suppressErrorToast only delegates notifications to the caller; error and security handling stay active.
 */
async function errorHandlerStage(ctx) {
    if (ctx.response.ok) return;
    const status = ctx.response.status;
    const errorText = stripAnsiCodes(await ctx.response.text());
    const log = status >= 500 ? console.error : ctx.suppressErrorToast ? console.debug : console.warn;
    log.call(console, `[api_pipeline] ${ctx.routeName} failed (${status}):`, errorText);
    const notice = resolveFailureNotice(status, errorText);
    if (!ctx.suppressErrorToast) {
        if (status === 403) {
            showAccessDeniedToast(ctx.routeName);
        } else {
            showRequestFailureNotice(notice.langKey, { status: notice.status });
        }
    }
    const error = new Error(`Virhe pyynnössä (${ctx.routeName}): ${errorText}`);
    error.status = status;
    // The same translated sentence for a caller that reports the failure in its
    // own surface, such as a chat bubble, instead of the technical message.
    error.failureNotice = notice;
    throw error;
}

/**
 * responseParseStage — parses the response body and stores result in ctx.parsedData.
 * Returns raw Response if ctx.returnResponse or ctx.stream is true.
 * Otherwise parses JSON or text based on Content-Type header.
 */
async function responseParseStage(ctx) {
    if (ctx.returnResponse || ctx.stream) {
        ctx.parsedData = ctx.response;
        return;
    }
    const contentType = ctx.response.headers.get('Content-Type') || '';
    if (contentType.includes('application/json')) {
        ctx.parsedData = await ctx.response.json();
    } else {
        ctx.parsedData = await ctx.response.text();
    }
}

// ==========================================
// Pipeline Configuration
// ==========================================

const apiRequestStages = [
    createStage('resolveUrl',          resolveUrlStage,          true),
    createStage('buildFetchOptions',   buildFetchOptionsStage,   true),
    createStage('csrf',                csrfStage,                true),
    createStage('fingerprint',         fingerprintStage,         false),
    createStage('execute',             executeStage,             true),
    createStage('csrfRecovery',        csrfRecoveryStage,        true),
    createStage('authRedirect',        authRedirectStage,        true),
    createStage('rateLimitHandler',    rateLimitHandlerStage,    false),
    createStage('serviceUnavailable',  serviceUnavailableHandlerStage, true),
    createStage('errorHandler',        errorHandlerStage,        true),
    createStage('responseParse',       responseParseStage,       true),
];

/**
 * runApiPipeline — runs a full API request through all stages.
 * On success, ctx.parsedData holds the final result.
 * If the pipeline aborts (e.g. auth redirect), the abort object is returned.
 *
 * Expected context shape:
 * {
 *   routeName: string,
 *   method?: string,       // default 'GET'
 *   bodyData?: any,        // request payload
 *   urlParams?: string,    // appended to URL e.g. '?id=1'
 *   headers?: Object,      // extra request headers
 *   stream?: boolean,      // return raw response (for SSE/streaming)
 *   suppressErrorToast?: boolean, // caller owns error/warning display; defaults to false
 *   returnResponse?: boolean, // return raw Response object
 * }
 *
 * @type {(context: Object) => Promise<Object>}
 */
export const runApiPipeline = createPipeline(apiRequestStages);
