// router.go
// Registers HTTP routes for the core backend.
// Bridges URL patterns to handlers while attaching security and middleware profiles.
// Exists to keep route declarations centralized and auditable.
package router

import (
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/auth"
	db_admin "easelect/backend/core_components/db_admin"
	devtools "easelect/backend/core_components/dev_tools"
	ai_features "easelect/backend/core_components/dynamic_table_tools/ai_features"
	"easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_create"
	"easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_delete"
	"easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read"
	"easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_update"
	dtt_2_column_crud "easelect/backend/core_components/dynamic_table_tools/dtt_2_column_crud"
	"easelect/backend/core_components/dynamic_table_tools/dtt_3_table_crud/dtt_3_table_delete"
	"easelect/backend/core_components/dynamic_table_tools/dtt_3_table_crud/dtt_3_table_read"
	dtt_asset_linking "easelect/backend/core_components/dynamic_table_tools/dtt_asset_linking"
	dtt_crud_workflows "easelect/backend/core_components/dynamic_table_tools/dtt_crud_workflows"
	dtt_foreign_keys "easelect/backend/core_components/dynamic_table_tools/dtt_foreign_keys"
	dtt_system_table_folders "easelect/backend/core_components/dynamic_table_tools/dtt_table_folders"
	dtt_triggers "easelect/backend/core_components/dynamic_table_tools/dtt_triggers"
	dtt_search_vectors "easelect/backend/core_components/dynamic_table_tools/search_vectors"
	"easelect/backend/core_components/event_bus"
	lang "easelect/backend/core_components/lang"
	productidentity "easelect/backend/core_components/product_identity"
	e_sessions "easelect/backend/core_components/sessions"
	"easelect/backend/core_components/system_table_tools"
	"easelect/backend/pipeline"
	"easelect/backend/reusable_components/vanilla_tree"
)

// localFrontendDir on polku staattisiin tiedostoihin (esim. "./frontend")
var localFrontendDir string

var localStorageDir string

// localAppsDir on polku apps-kansion staattisiin tiedostoihin (esim. "./apps")
var localAppsDir string

type RouteMatchType string

const (
	RouteMatchExact  RouteMatchType = "exact"
	RouteMatchPrefix RouteMatchType = "prefix"
)

// RouteDefinition stores one registered route plus the metadata needed for
// manifest generation and startup wiring.
type RouteDefinition struct {
	UrlPattern        string
	MatchType         RouteMatchType
	HandlerFunc       http.HandlerFunc
	HandlerName       string
	ConditionalSource string
}

// routeDefinitions kerää reitit muistiin
var routeDefinitions []RouteDefinition

// registeredFunctions pitää kirjaa funktioista, joita on lopulta rekisteröity
var registeredFunctions = make(map[string]bool)

// FunctionIDs maps handler names to their ID in the `system_functions` table.
var FunctionIDs = make(map[string]int)

const (
	// defaultRateLimitAmount is the default maximum number of calls allowed
	// within defaultRateLimitMinutes when a new function is registered.
	defaultRateLimitAmount  = 200
	defaultRateLimitMinutes = 20
)

// RegisterRoutes tallentaa reittien määritykset
func RegisterRoutes(frontendDir string, storagePath string) {
	ResetRouteDefinitions()
	localFrontendDir = frontendDir

	// Otetaan storagePath talteen
	localStorageDir = storagePath

	// Apps-kansio: derive from executable location for consistent path resolution
	if execPath, err := os.Executable(); err == nil {
		localAppsDir = filepath.Join(filepath.Dir(execPath), "apps")
	} else {
		localAppsDir = "./apps" // fallback
	}

	// Staattiset reitit
	functionRegisterHandler("/favicon4S.png", faviconHandler, "router.faviconHandler")
	functionRegisterHandler("/frontend/", handleFrontend, "router.handleFrontend")
	functionRegisterHandler("/apps/", handleApps, "router.handleApps")
	functionRegisterHandler("/storage/", ServeStorage, "router.ServeStorage")
	functionRegisterHandler("/robots.txt", robotsHandler, "router.robotsHandler")
	functionRegisterHandler("/health", healthHandler, "router.healthHandler")
	functionRegisterHandler("/system/health", systemHealthHandler, "router.systemHealthHandler")
	functionRegisterHandler("/system/ready", systemReadyHandler, "router.systemReadyHandler")
	functionRegisterHandler("/system/instance-status", systemInstanceStatusHandler, "router.systemInstanceStatusHandler")
	functionRegisterHandler("/system/drain", systemDrainHandler, "router.systemDrainHandler")
	functionRegisterHandler("/api/admin/version-info", adminVersionInfoHandler, "router.adminVersionInfoHandler")
	functionRegisterHandler("/api/admin/openai-api-key", saveOpenAIAPIKeyHandler, "router.saveOpenAIAPIKeyHandler")
	functionRegisterHandler("/sitemap.xml", sitemapHandler, "router.sitemapHandler")
	functionRegisterHandler("/datasets/", datasetsRedirectHandler, "router.datasetsRedirectHandler")
	functionRegisterHandler("/admin/", adminHandler, "router.adminHandler")

	// Julkiset reitit
	functionRegisterHandler("/", rootHandler, "router.rootHandler")
	functionRegisterHandler("/api/auth-modes", auth.GetAuthModesHandler, "auth.GetAuthModesHandler")
	functionRegisterHandler("/api/product-identity", productidentity.Handler, "product_identity.Handler")
	functionRegisterHandler("/api/check-fingerprint", auth.CheckFingerprintHandler, "auth.CheckFingerprintHandler")
	functionRegisterHandler("/api/reset-session", e_sessions.ResetSessionHandler, "e_sessions.ResetSessionHandler")

	// UI Routes (GET only)
	functionRegisterHandler("/login", auth.LoginHandler, "auth.LoginHandler")
	functionRegisterHandler("/first-run", auth.FirstRunAdminHandler, "auth.FirstRunAdminHandler")
	functionRegisterHandler("/register_ndYOyXV0INOK3F", auth.RegisterHandler, "auth.RegisterHandler")

	// API Routes (POST/Action)
	functionRegisterHandler("/api/login", auth.LoginAPIHandler, "auth.LoginAPIHandler")
	functionRegisterHandler("/api/request-password-reset-otp", auth.RequestPasswordResetOTPHandler, "auth.RequestPasswordResetOTPHandler")
	functionRegisterHandler("/api/reset-password", auth.ResetPasswordWithOTPHandler, "auth.ResetPasswordWithOTPHandler")
	functionRegisterHandler("/api/logout", auth.LogoutHandler, "auth.LogoutHandler")
	functionRegisterHandler("/api/register_ndYOyXV0INOK3F", auth.RegisterAPIHandler, "auth.RegisterAPIHandler")
	functionRegisterHandler("/api/csrf-token", auth.CSRFTokenHandler, "auth.CSRFTokenHandler")
	functionRegisterHandler("/api/user-profile", auth.UserProfileFetchHandler, "auth.UserProfileFetchHandler")
	functionRegisterHandler("/api/update-profile", auth.UserProfileUpdateHandler, "auth.UserProfileUpdateHandler")
	functionRegisterHandler("/api/request-email-change-otp", auth.RequestEmailChangeOTPHandler, "auth.RequestEmailChangeOTPHandler")
	functionRegisterHandler("/api/request-password-change-otp", auth.RequestPasswordChangeOTPHandler, "auth.RequestPasswordChangeOTPHandler")

	// DevTools-reitit (vain eksplisiittisessä kehitysympäristössä)
	envType := os.Getenv("ENVIRONMENT_TYPE")
	isDevEnvironment := envType == "dev"
	if isDevEnvironment {
		const devOnlyCondition = "ENVIRONMENT_TYPE='dev'"
		functionRegisterConditionalHandler("/api/sessioninfo", devtools.SessionHandler, "devtools.SessionHandler", devOnlyCondition)
		functionRegisterConditionalHandler("/api/export-table-csv", devtools.ExportTableCSVHandler, "devtools.ExportTableCSVHandler", devOnlyCondition)
		functionRegisterConditionalHandler("/api/import-table-csv", devtools.ImportTableCSVHandler, "devtools.ImportTableCSVHandler", devOnlyCondition)
		functionRegisterConditionalHandler("/api/check-json-columns", devtools.CheckJsonInTextColumnsHandler, "devtools.CheckJsonInTextColumnsHandler", devOnlyCondition)
		functionRegisterConditionalHandler("/api/queen/runs", devtools.QueenRunsHandler, "devtools.QueenRunsHandler", devOnlyCondition)
		functionRegisterConditionalHandler("/api/queen/sessions", devtools.QueenSessionsHandler, "devtools.QueenSessionsHandler", devOnlyCondition)
		functionRegisterConditionalHandler("/api/queen/session", devtools.QueenSessionHandler, "devtools.QueenSessionHandler", devOnlyCondition)
		functionRegisterConditionalHandler("/api/queen/session/message", devtools.QueenSessionMessageHandler, "devtools.QueenSessionMessageHandler", devOnlyCondition)
		functionRegisterConditionalHandler("/api/queen/session/stream", devtools.QueenSessionStreamHandler, "devtools.QueenSessionStreamHandler", devOnlyCondition)
		functionRegisterConditionalHandler("/api/queen/session/stop", devtools.QueenSessionStopHandler, "devtools.QueenSessionStopHandler", devOnlyCondition)
		functionRegisterConditionalHandler("/api/queen/transcript", devtools.QueenTranscriptHandler, "devtools.QueenTranscriptHandler", devOnlyCondition)
		functionRegisterConditionalHandler("/api/queen/transcript/stream", devtools.QueenTranscriptStreamHandler, "devtools.QueenTranscriptStreamHandler", devOnlyCondition)
		functionRegisterConditionalHandler("/api/log-client-error", devtools.LogClientError, "devtools.LogClientError", devOnlyCondition)
		functionRegisterConditionalHandler("/api/pipeline-info", pipeline.IntrospectionHandler, "pipeline.IntrospectionHandler", devOnlyCondition)
		functionRegisterConditionalHandler("/api/update-lang-key", lang.UpdateLangKeyHandler, "lang.UpdateLangKeyHandler", devOnlyCondition)
		functionRegisterConditionalHandler("/api/dev-ai-translate-single", lang.AiTranslateSingleHandler, "lang.AiTranslateSingleHandler", devOnlyCondition)
	} else {
		log.Printf("Skipping dev tool route registration because ENVIRONMENT_TYPE=%q", envType)
	}

	// Access-kontrolloidut dtt- ja system_table_tools -reitit
	functionRegisterHandler("/api/add_foreign_key", dtt_foreign_keys.AddForeignKeyHandler, "dtt_foreign_keys.AddForeignKeyHandler")
	functionRegisterHandler("/api/delete_foreign_key", dtt_foreign_keys.DeleteForeignKeyHandler, "dtt_foreign_keys.DeleteForeignKeyHandler")
	functionRegisterHandler("/api/foreign_keys", dtt_foreign_keys.GetForeignKeys, "dtt_foreign_keys.GetForeignKeys")
	functionRegisterHandler("/api/dataset-names", dtt_foreign_keys.GetTableNamesHandler, "dtt_foreign_keys.GetTableNamesHandler")
	functionRegisterHandler("/api/dataset-aliases", GetDatasetAliasesHandler, "router.GetDatasetAliasesHandler")
	functionRegisterHandler("/api/dataset-alias-management", GetDatasetAliasManagementHandler, "router.GetDatasetAliasManagementHandler")
	functionRegisterHandler("/api/dataset-alias-management/save", SaveDatasetAliasManagementHandler, "router.SaveDatasetAliasManagementHandler")
	functionRegisterHandler("/api/asset-linking/images/enable", dtt_asset_linking.EnableImageAssetLinkingHandler, "dtt_asset_linking.EnableImageAssetLinkingHandler")
	functionRegisterHandler("/api/asset-linking/images/disable", dtt_asset_linking.DisableImageAssetLinkingHandler, "dtt_asset_linking.DisableImageAssetLinkingHandler")
	functionRegisterHandler("/api/asset-linking/images/remove", dtt_asset_linking.RemoveImageAssetLinkingHandler, "dtt_asset_linking.RemoveImageAssetLinkingHandler")
	functionRegisterHandler("/api/asset-linking/images/status", dtt_asset_linking.GetImageAssetLinkingStatusHandler, "dtt_asset_linking.GetImageAssetLinkingStatusHandler")
	functionRegisterHandler("/api/asset-linking/images/update", dtt_asset_linking.UpdateImageAssetLinkingHandler, "dtt_asset_linking.UpdateImageAssetLinkingHandler")
	functionRegisterHandler("/api/asset-linking/attachments/enable", dtt_asset_linking.EnableAttachmentLinkingHandler, "dtt_asset_linking.EnableAttachmentLinkingHandler")
	functionRegisterHandler("/api/asset-linking/attachments/disable", dtt_asset_linking.DisableAttachmentLinkingHandler, "dtt_asset_linking.DisableAttachmentLinkingHandler")
	functionRegisterHandler("/api/asset-linking/attachments/remove", dtt_asset_linking.RemoveAttachmentLinkingHandler, "dtt_asset_linking.RemoveAttachmentLinkingHandler")
	functionRegisterHandler("/api/asset-linking/attachments/status", dtt_asset_linking.GetAttachmentLinkingStatusHandler, "dtt_asset_linking.GetAttachmentLinkingStatusHandler")
	functionRegisterHandler("/api/asset-linking/status", dtt_asset_linking.GetAssetLinkingStatusHandler, "dtt_asset_linking.GetAssetLinkingStatusHandler")
	functionRegisterHandler("/api/embedding-datasets", ai_features.GetEmbeddingDatasetsHandler, "ai_features.GetEmbeddingDatasetsHandler")
	functionRegisterHandler("/api/dataset_permissions", backend.PermissionsHandler, "backend.PermissionsHandler")
	functionRegisterHandler("/api/datasets", system_table_tools.GetGroupedTables, "system_table_tools.GetGroupedTables")
	functionRegisterHandler("/api/update-oids", system_table_tools.HandleUpdateOidsAndTableNames, "system_table_tools.HandleUpdateOidsAndTableNames")
	functionRegisterHandler("/api/empty-rows", system_table_tools.GetEmptyRowsHandler, "system_table_tools.GetEmptyRowsHandler")
	functionRegisterHandler("/api/check-media-tables", system_table_tools.CheckMediaTableFoldersHandler, "system_table_tools.CheckMediaTableFoldersHandler")
	functionRegisterHandler("/api/archive-media-tables", system_table_tools.ArchiveMediaTableFoldersHandler, "system_table_tools.ArchiveMediaTableFoldersHandler")
	functionRegisterHandler("/api/check-archived-media-tables", system_table_tools.CheckArchivedMediaTableFoldersHandler, "system_table_tools.CheckArchivedMediaTableFoldersHandler")
	functionRegisterHandler("/api/prune-archived-media-tables", system_table_tools.PruneArchivedMediaTableFoldersHandler, "system_table_tools.PruneArchivedMediaTableFoldersHandler")
	functionRegisterHandler("/api/check-media-rows", system_table_tools.CheckMediaRowFoldersHandler, "system_table_tools.CheckMediaRowFoldersHandler")
	functionRegisterHandler("/api/check-media-subfolders", system_table_tools.CheckMediaSubfoldersHandler, "system_table_tools.CheckMediaSubfoldersHandler")
	functionRegisterHandler("/api/fix-media-subfolders", system_table_tools.FixMediaSubfoldersHandler, "system_table_tools.FixMediaSubfoldersHandler")
	functionRegisterHandler("/api/check-db-consistency", system_table_tools.CheckDatabaseConsistencyHandler, "system_table_tools.CheckDatabaseConsistencyHandler")
	functionRegisterHandler("/api/fix-db-consistency", system_table_tools.FixDatabaseConsistencyHandler, "system_table_tools.FixDatabaseConsistencyHandler")
	functionRegisterHandler("/api/log-retention/preview", system_table_tools.PreviewLogRetentionHandler, "system_table_tools.PreviewLogRetentionHandler")
	functionRegisterHandler("/api/log-retention/prune", system_table_tools.PruneLogRetentionHandler, "system_table_tools.PruneLogRetentionHandler")
	functionRegisterHandler("/api/data-retention/preview", system_table_tools.PreviewDataRetentionHandler, "system_table_tools.PreviewDataRetentionHandler")
	functionRegisterHandler("/api/data-retention/prune", system_table_tools.PruneDataRetentionHandler, "system_table_tools.PruneDataRetentionHandler")
	functionRegisterHandler("/api/scan-lang-sources", system_table_tools.ScanLangSourcesHandler, "system_table_tools.ScanLangSourcesHandler")
	functionRegisterHandler("/api/fk-cache-triggers", system_table_tools.ListFKCacheTriggersHandler, "system_table_tools.ListFKCacheTriggersHandler")
	functionRegisterHandler("/api/fk-cache-refresh", system_table_tools.RefreshFKCacheHandler, "system_table_tools.RefreshFKCacheHandler")
	functionRegisterHandler("/api/update-tab-order", system_table_tools.UpdateTabOrderHandler, "system_table_tools.UpdateTabOrderHandler")
	functionRegisterHandler("/api/card-visibility/update", system_table_tools.UpdateCardVisibilityHandler, "system_table_tools.UpdateCardVisibilityHandler")
	functionRegisterHandler("/api/card-visibility/", system_table_tools.GetCardVisibilityHandler, "system_table_tools.GetCardVisibilityHandler")
	functionRegisterHandler("/api/dataset-header-config/save", system_table_tools.SaveDatasetHeaderConfigHandler, "system_table_tools.SaveDatasetHeaderConfigHandler")
	functionRegisterHandler("/api/dataset-header-config/", system_table_tools.GetDatasetHeaderConfigHandler, "system_table_tools.GetDatasetHeaderConfigHandler")
	functionRegisterHandler("/api/child-tab-config/save", system_table_tools.SaveChildTabConfigHandler, "system_table_tools.SaveChildTabConfigHandler")
	functionRegisterHandler("/api/child-tab-config/", system_table_tools.GetChildTabConfigHandler, "system_table_tools.GetChildTabConfigHandler")
	functionRegisterHandler("/api/column-view-presets/save", system_table_tools.SaveColumnViewPresetHandler, "system_table_tools.SaveColumnViewPresetHandler")
	functionRegisterHandler("/api/column-view-presets/delete", system_table_tools.DeleteColumnViewPresetHandler, "system_table_tools.DeleteColumnViewPresetHandler")
	functionRegisterHandler("/api/column-view-presets/", system_table_tools.ListColumnViewPresetsHandler, "system_table_tools.ListColumnViewPresetsHandler")
	functionRegisterHandler("/api/filterbar-section-layout/save", system_table_tools.SaveFilterbarSectionLayoutHandler, "system_table_tools.SaveFilterbarSectionLayoutHandler")
	functionRegisterHandler("/api/filterbar-section-layout", system_table_tools.GetFilterbarSectionLayoutHandler, "system_table_tools.GetFilterbarSectionLayoutHandler")
	functionRegisterHandler("/api/task-todo-progress", system_table_tools.GetTaskTodoProgressHandler, "system_table_tools.GetTaskTodoProgressHandler")

	// dtt_1_row_create
	functionRegisterHandler("/api/add-row-multipart", dtt_1_row_create.AddRowMultipartHandlerWrapper, "dtt_1_row_create.AddRowMultipartHandlerWrapper")
	functionRegisterHandler("/api/geocode-address", dtt_1_row_create.GeocodeAddressHandler, "dtt_1_row_create.GeocodeAddressHandler")
	functionRegisterHandler("/api/get-1m-relations", dtt_1_row_create.GetOneToManyRelationsHandlerWrapper, "dtt_1_row_create.GetOneToManyRelationsHandlerWrapper")
	functionRegisterHandler("/api/get-add-row-metadata", dtt_1_row_create.GetAddRowMetadataHandlerWrapper, "dtt_1_row_create.GetAddRowMetadataHandlerWrapper")
	functionRegisterHandler("/api/get-columns", dtt_1_row_create.GetAddRowColumnsHandlerWrapper, "dtt_1_row_create.GetAddRowColumnsHandlerWrapper")
	functionRegisterHandler("/api/get-many-to-many", dtt_1_row_create.GetManyToManyTablesHandlerWrapper, "dtt_1_row_create.GetManyToManyTablesHandlerWrapper")
	functionRegisterHandler("/api/referenced-data", dtt_1_row_create.GetReferencedTableData, "dtt_1_row_create.GetReferencedTableData")

	// dtt_1_row_delete
	functionRegisterHandler("/api/delete-rows", dtt_1_row_delete.DeleteRowsHandlerWrapper, "dtt_1_row_delete.DeleteRowsHandlerWrapper")

	// dtt_3_table_crud
	// Table CRUD
	functionRegisterHandler("/api/drop-dataset", dtt_3_table_delete.DropTableHandler, "dtt_3_table_delete.DropTableHandler")
	functionRegisterHandler("/api/get-metadata", dtt_3_table_read.GetTableViewHandlerWrapper, "dtt_3_table_read.GetTableViewHandlerWrapper")

	// dtt_1_row_read
	functionRegisterHandler("/api/fetch-dynamic-children", dtt_1_row_read.GetDynamicChildItemsHandler, "dtt_1_row_read.GetDynamicChildItemsHandler")
	functionRegisterHandler("/api/comments", dtt_1_row_read.CommentListHandler, "dtt_1_row_read.CommentListHandler")
	functionRegisterHandler("/api/comments/create", dtt_1_row_read.CommentCreateHandler, "dtt_1_row_read.CommentCreateHandler")
	functionRegisterHandler("/api/comments/delete", dtt_1_row_read.CommentDeleteHandler, "dtt_1_row_read.CommentDeleteHandler")
	functionRegisterHandler("/api/comment-counts", dtt_1_row_read.CommentCountHandler, "dtt_1_row_read.CommentCountHandler")
	functionRegisterHandler("/api/get-intelligent-results", dtt_1_row_read.GetIntelligentResultsHandlerWrapper, "dtt_1_row_read.GetIntelligentResultsHandlerWrapper")
	functionRegisterHandler("/api/get-filter-options", dtt_1_row_read.GetFilterOptionsHandler, "dtt_1_row_read.GetFilterOptionsHandler")
	functionRegisterHandler("/api/get-results", dtt_1_row_read.GetResultsHandlerWrapper, "dtt_1_row_read.GetResultsHandlerWrapper")
	functionRegisterHandler("/api/get-results-vector", dtt_1_row_read.GetResultsVector, "dtt_1_row_read.GetResultsVector")
	functionRegisterHandler("/api/get-row-count", dtt_1_row_read.GetRowCountHandlerWrapper, "dtt_1_row_read.GetRowCountHandlerWrapper")

	functionRegisterHandler("/api/system_triggers/create", dtt_triggers.CreateTriggerHandler, "dtt_triggers.CreateTriggerHandler")
	functionRegisterHandler("/api/system_triggers/list", dtt_triggers.GetTriggersHandler, "dtt_triggers.GetTriggersHandler")
	functionRegisterHandler("/api/dataset-columns/", dtt_2_column_crud.GetTableColumnsHandler, "dtt_2_column_crud.GetTableColumnsHandler")
	functionRegisterHandler("/api/update-row", dtt_1_row_update.UpdateRowHandlerWrapper, "dtt_1_row_update.UpdateRowHandlerWrapper")

	// Muut reitit
	functionRegisterHandler("/api/update-folder", dtt_system_table_folders.HandleUpdateFolder, "dtt_system_table_folders.HandleUpdateFolder")
	functionRegisterHandler("/api/update-table-folder", dtt_system_table_folders.HandleUpdateTableFolder, "dtt_system_table_folders.HandleUpdateTableFolder")
	functionRegisterHandler("/api/set-current-project-folder", dtt_system_table_folders.HandleSetCurrentProjectFolder, "dtt_system_table_folders.HandleSetCurrentProjectFolder")
	functionRegisterHandler("/api/create-folder", dtt_system_table_folders.HandleCreateFolder, "dtt_system_table_folders.HandleCreateFolder")
	functionRegisterHandler("/api/delete-folder", dtt_system_table_folders.HandleDeleteFolder, "dtt_system_table_folders.HandleDeleteFolder")
	functionRegisterHandler("/api/rename-tree-node", dtt_system_table_folders.HandleRenameTreeNode, "dtt_system_table_folders.HandleRenameTreeNode")
	if os.Getenv("ENABLE_API_LANGUAGE") == "true" {
		const apiLanguageCondition = "ENABLE_API_LANGUAGE=true"
		log.Printf("Registering /api/create-table because ENABLE_API_LANGUAGE=true")
		functionRegisterConditionalHandler("/api/create-table", dtt_crud_workflows.SimpleCreateTableHandler, "dtt_crud_workflows.SimpleCreateTableHandler", apiLanguageCondition)
		log.Printf("Registering /api/query-table because ENABLE_API_LANGUAGE=true")
		functionRegisterConditionalHandler("/api/query-table", dtt_crud_workflows.SimpleQueryTableHandler, "dtt_crud_workflows.SimpleQueryTableHandler", apiLanguageCondition)
	} else {
		log.Printf("Not registering /api/create-table because ENABLE_API_LANGUAGE=%s", os.Getenv("ENABLE_API_LANGUAGE"))
	}
	functionRegisterHandler("/api/create_dataset", dtt_crud_workflows.CreateTableHandler, "dtt_crud_workflows.CreateTableHandler")
	functionRegisterHandler("/api/generateTranslations", lang.GenerateTranslationsHandler, "lang.GenerateTranslationsHandler")
	functionRegisterHandler("/api/fix-translations", lang.FixTableTranslationsHandler, "lang.FixTableTranslationsHandler")
	functionRegisterHandler("/api/modify-columns", dtt_crud_workflows.ModifyColumnsHandler, "dtt_crud_workflows.ModifyColumnsHandler")
	functionRegisterHandler("/api/set-comments", dtt_crud_workflows.SetCommentsHandler, "dtt_crud_workflows.SetCommentsHandler")
	functionRegisterHandler("/api/create-indexes", dtt_crud_workflows.CreateIndexesHandler, "dtt_crud_workflows.CreateIndexesHandler")
	functionRegisterHandler("/api/embedding_stream_handler", ai_features.EmbeddingStreamHandler, "ai_features.EmbeddingStreamHandler")
	functionRegisterHandler("/api/sse/subscribe", event_bus.SSESubscribeHandler, "event_bus.SSESubscribeHandler")
	functionRegisterHandler("/api/refresh-lang-embeddings", ai_features.RefreshLangEmbeddingsHandler, "ai_features.RefreshLangEmbeddingsHandler")
	functionRegisterHandler("/api/count-lang-embeddings", ai_features.CountLangEmbeddingsHandler, "ai_features.CountLangEmbeddingsHandler")
	functionRegisterHandler("/api/text-index-status", dtt_search_vectors.TextIndexStatusHandler, "dtt_search_vectors.TextIndexStatusHandler")
	functionRegisterHandler("/api/rebuild-search-vectors", dtt_search_vectors.RebuildSearchVectorHandler, "dtt_search_vectors.RebuildSearchVectorHandler")
	functionRegisterHandler("/api/save-usergroup-right", backend.SaveUserGroupRight, "backend.SaveUserGroupRight")

	// DB Role Management (admin-only, non-table-specific)
	functionRegisterHandler("/api/db-roles", db_admin.ListRolesHandler, "db_admin.ListRolesHandler")
	functionRegisterHandler("/api/db-roles/create", db_admin.CreateRoleHandler, "db_admin.CreateRoleHandler")
	functionRegisterHandler("/api/db-roles/update", db_admin.UpdateRoleHandler, "db_admin.UpdateRoleHandler")
	functionRegisterHandler("/api/db-roles/delete", db_admin.DeleteRoleHandler, "db_admin.DeleteRoleHandler")
	functionRegisterHandler("/api/translations", lang.GetTranslationsHandler, "lang.GetTranslationsHandler")
	functionRegisterHandler("/api/get-lang-key-translations", lang.GetLangKeyTranslationsHandler, "lang.GetLangKeyTranslationsHandler")
	functionRegisterHandler("/api/about", system_table_tools.GetAboutRowHandler, "system_table_tools.GetAboutRowHandler")
	functionRegisterHandler("/api/user-permissions", auth.UserPermissionsHandler, "auth.UserPermissionsHandler")
	functionRegisterHandler("/api/check-table-right", auth.CheckTableRightHandler, "auth.CheckTableRightHandler")
	functionRegisterHandler("/api/check-table-rights", auth.CheckTableRightsHandler, "auth.CheckTableRightsHandler")
	functionRegisterHandler("/api/check-table-rights-multi", auth.CheckTableRightsMultiHandler, "auth.CheckTableRightsMultiHandler")
	functionRegisterHandler("/api/tree_data", vanilla_tree.GetTreeDataHandler, "vanilla_tree.GetTreeDataHandler")
	functionRegisterHandler("/api/get-view-data", vanilla_tree.GetViewDataHandler, "vanilla_tree.GetViewDataHandler")

	// Register optional private maintainer routes outside apps/.
	RegisterMaintainerToolRoutes()

	// Register application routes (apps)
	RegisterAppRoutes()
}

// ResetRouteDefinitions clears the in-memory route registry before a fresh
// registration pass. Tests and generators use this to avoid append-only drift.
func ResetRouteDefinitions() {
	routeDefinitions = nil
}

// GetRouteDefinitions returns the registered route definitions for testing and introspection.
func GetRouteDefinitions() []RouteDefinition {
	return append([]RouteDefinition(nil), routeDefinitions...)
}

// functionRegisterHandler lisää reittitietueen muistiin (EI tee http.HandleFunc vielä)
func functionRegisterHandler(urlPattern string, handlerFunc http.HandlerFunc, handlerName string) {
	functionRegisterConditionalHandler(urlPattern, handlerFunc, handlerName, "")
}

func functionRegisterConditionalHandler(urlPattern string, handlerFunc http.HandlerFunc, handlerName string, conditionalSource string) {
	routeDefinitions = append(routeDefinitions, RouteDefinition{
		UrlPattern:        urlPattern,
		MatchType:         routeMatchTypeForPattern(urlPattern),
		HandlerFunc:       handlerFunc,
		HandlerName:       handlerName,
		ConditionalSource: conditionalSource,
	})
}

func routeMatchTypeForPattern(urlPattern string) RouteMatchType {
	if urlPattern == "/" || strings.HasSuffix(urlPattern, "/") {
		return RouteMatchPrefix
	}
	return RouteMatchExact
}

// ============================================================
//  ACCESS CONTROL EXCEPTION LISTS
//  These package-level maps define which handlers bypass normal
//  access control.  The logic that reads them lives in
//  routing_helpers.go → RegisterAllRoutesAndUpdateFunctions.
// ============================================================

// ============================================================
//  ACCESS CONTROL EXCEPTION LISTS — LEGACY (now in pipeline/route_profiles.go)
//  These maps are kept temporarily as documentation reference.
//  The Pipeline Mediator (pipeline.RouteProfiles) is the new
//  single source of truth for per-route middleware configuration.
//  TODO: Remove these after verification that pipeline works correctly.
// ============================================================

// noAccessControlNeeded — LEGACY: migrated to pipeline.PublicProfile in route_profiles.go
// var noAccessControlNeeded = map[string]bool{ ... }

// devOnlyNoAccessControl — LEGACY: migrated to pipeline.ApplyDevOverrides() in route_profiles.go
// var devOnlyNoAccessControl = []string{ ... }

// loginOnlyNeeded — LEGACY: migrated to pipeline.LoginOnlyProfile in route_profiles.go
// var loginOnlyNeeded = map[string]bool{ ... }

// adminOnlyRoutes — LEGACY: migrated to pipeline.AdminProfile in route_profiles.go
// var adminOnlyRoutes = map[string]bool{ ... }

// defaultTableSpecificPackages lists packages whose handlers
// typically require table-level access control. When a new
// function is registered for these packages, the
// specific_table_related flag defaults to true. Existing rows keep
// their stored value so manual adjustments in the database are not
// overwritten.
var defaultTableSpecificPackages = map[string]bool{
	"dtt_1_row_create":   true,
	"dtt_1_row_delete":   true,
	"dtt_1_row_read":     true,
	"dtt_1_row_update":   true,
	"dtt_2_column_crud":  true,
	"dtt_3_table_delete": true,
	"dtt_3_table_read":   true,
	"dtt_crud_workflows": true,
	"dtt_foreign_keys":   true,
	// dtt_system_table_folders operates on navigation folders
	// and most of its handlers (e.g., /api/update-folder) are
	// tableless by design, so it is intentionally omitted here.
	// The table-move route is the explicit mixed-package exception
	// and is handled via a per-handler override in routing_builder.go.
	"dtt_triggers": true,
}
