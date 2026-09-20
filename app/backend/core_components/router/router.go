// router.go
// Registers HTTP routes for the core backend.
// Bridges URL patterns to handlers while attaching security and middleware profiles.
// Exists to keep route declarations centralized and auditable.
package router

import (
	"easelect/backend/core_components/media_library"
	"fmt"
	"log"
	"net/http"
	"os"
	"path"
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
	frontendassets "easelect/backend/core_components/frontend_assets"
	lang "easelect/backend/core_components/lang"
	productidentity "easelect/backend/core_components/product_identity"
	e_sessions "easelect/backend/core_components/sessions"
	"easelect/backend/core_components/symbol_registry"
	"easelect/backend/core_components/system_table_tools"
	"easelect/backend/pipeline"
	image_source_picker "easelect/backend/reusable_components/image_source_picker"
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
	Methods           []string
	MethodSource      string
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

	// Storage reads arrive in browser bursts: one result page can legitimately
	// request hundreds of thumbnails and detail variants. Keep a bounded,
	// per-client window, but do not reuse the low generic API-route default.
	storageRateLimitAmount  = 5000
	storageRateLimitMinutes = 20
)

func defaultRateLimitForHandler(handlerName string) (int, int) {
	if handlerName == "router.ServeStorage" {
		return storageRateLimitAmount, storageRateLimitMinutes
	}
	return defaultRateLimitAmount, defaultRateLimitMinutes
}

// reconcileExistingRateLimit upgrades only the untouched legacy default.
// Explicit operator choices, including a disabled zero limit, remain intact.
func reconcileExistingRateLimit(handlerName string, amount, minutes int) (int, int) {
	desiredAmount, desiredMinutes := defaultRateLimitForHandler(handlerName)
	if amount == defaultRateLimitAmount && minutes == defaultRateLimitMinutes {
		return desiredAmount, desiredMinutes
	}
	return amount, minutes
}

// RegisterRoutes tallentaa reittien määritykset
func RegisterRoutes(frontendDir string, storagePath string) {
	ResetRouteDefinitions()
	localFrontendDir = frontendDir
	symbol_registry.ConfigureDirectory(filepath.Join(frontendDir, "icons", "symbols"))

	// Otetaan storagePath talteen
	localStorageDir = storagePath

	// Apps-kansio: derive from executable location for consistent path resolution
	if execPath, err := os.Executable(); err == nil {
		localAppsDir = filepath.Join(filepath.Dir(execPath), "apps")
	} else {
		localAppsDir = "./apps" // fallback
	}

	// Staattiset reitit
	functionRegisterHandler("/favicon4S.png", faviconHandler, "router.faviconHandler", http.MethodGet)
	functionRegisterHandler("/frontend/", handleFrontend, "router.handleFrontend", http.MethodGet)
	functionRegisterHandler("/symbol-assets/", symbol_registry.AssetHandler, "symbol_registry.AssetHandler", http.MethodGet)
	functionRegisterHandler("/apps/", handleApps, "router.handleApps", http.MethodGet)
	functionRegisterHandler("/storage/", ServeStorage, "router.ServeStorage", http.MethodGet)
	functionRegisterHandler("/api/media-library/list", media_library.ListHandler, "media_library.ListHandler", http.MethodGet)
	functionRegisterHandler("/api/media-library/attach", media_library.AttachHandler, "media_library.AttachHandler", http.MethodPost)
	functionRegisterHandler("/api/media-library/detach", media_library.DetachHandler, "media_library.DetachHandler", http.MethodPost)
	functionRegisterHandler("/robots.txt", robotsHandler, "router.robotsHandler", http.MethodGet)
	functionRegisterHandler("/health", healthHandler, "router.healthHandler", http.MethodGet)
	functionRegisterHandler("/system/health", systemHealthHandler, "router.systemHealthHandler", http.MethodGet)
	functionRegisterHandler("/system/ready", systemReadyHandler, "router.systemReadyHandler", http.MethodGet)
	functionRegisterHandler("/system/instance-status", systemInstanceStatusHandler, "router.systemInstanceStatusHandler", http.MethodGet)
	functionRegisterHandler("/system/drain", systemDrainHandler, "router.systemDrainHandler", http.MethodPost)
	functionRegisterHandler("/system/automation-account", systemAutomationAccountHandler, "router.systemAutomationAccountHandler", http.MethodGet, http.MethodPost)
	functionRegisterHandler("/system/update-notice", systemUpdateNoticeHandler, "router.systemUpdateNoticeHandler", http.MethodPost)
	functionRegisterHandler("/api/admin/version-info", adminVersionInfoHandler, "router.adminVersionInfoHandler", http.MethodGet, http.MethodPost)
	functionRegisterHandler("/api/admin/site-assistant/api-catalog", siteAssistantAPICatalogHandler, "router.siteAssistantAPICatalogHandler", http.MethodGet)
	functionRegisterHandler("/api/site-assistant/delegation/exchange", auth.SiteAssistantDelegationExchangeHandler, "auth.SiteAssistantDelegationExchangeHandler", http.MethodPost)
	functionRegisterHandler("/api/admin/update-notice/stream", adminUpdateNoticeStreamHandler, "router.adminUpdateNoticeStreamHandler", http.MethodGet)
	functionRegisterHandler("/api/admin/openai-api-key", saveOpenAIAPIKeyHandler, "router.saveOpenAIAPIKeyHandler", http.MethodPost)
	functionRegisterHandler("/sitemap.xml", sitemapHandler, "router.sitemapHandler", http.MethodGet)
	functionRegisterHandler("/datasets/", datasetsRedirectHandler, "router.datasetsRedirectHandler", http.MethodGet)
	functionRegisterHandler("/admin/", adminHandler, "router.adminHandler", http.MethodGet)

	// Julkiset reitit
	functionRegisterHandler("/", rootHandler, "router.rootHandler", http.MethodGet)
	functionRegisterHandler("/api/auth-modes", auth.GetAuthModesHandler, "auth.GetAuthModesHandler", http.MethodGet)
	functionRegisterHandler("/api/product-identity", productidentity.Handler, "product_identity.Handler", http.MethodGet)
	functionRegisterHandler("/api/check-fingerprint", auth.CheckFingerprintHandler, "auth.CheckFingerprintHandler", http.MethodPost)
	functionRegisterHandler("/api/reset-session", e_sessions.ResetSessionHandler, "e_sessions.ResetSessionHandler", http.MethodPost)

	// UI Routes (GET only)
	functionRegisterHandler("/login", auth.LoginHandler, "auth.LoginHandler", http.MethodGet, http.MethodPost)
	functionRegisterHandler("/first-run", auth.FirstRunAdminHandler, "auth.FirstRunAdminHandler", http.MethodGet, http.MethodPost)
	functionRegisterHandler("/register_ndYOyXV0INOK3F", auth.RegisterHandler, "auth.RegisterHandler", http.MethodGet)

	// API Routes (POST/Action)
	functionRegisterHandler("/api/login", auth.LoginAPIHandler, "auth.LoginAPIHandler", http.MethodPost)
	functionRegisterHandler("/api/request-password-reset-otp", auth.RequestPasswordResetOTPHandler, "auth.RequestPasswordResetOTPHandler", http.MethodPost)
	functionRegisterHandler("/api/reset-password", auth.ResetPasswordWithOTPHandler, "auth.ResetPasswordWithOTPHandler", http.MethodPost)
	functionRegisterHandler("/api/logout", auth.LogoutHandler, "auth.LogoutHandler", http.MethodGet)
	functionRegisterHandler("/api/register_ndYOyXV0INOK3F", auth.RegisterAPIHandler, "auth.RegisterAPIHandler", http.MethodPost)
	functionRegisterHandler("/api/csrf-token", auth.CSRFTokenHandler, "auth.CSRFTokenHandler", http.MethodGet)
	functionRegisterHandler("/api/user-profile", auth.UserProfileFetchHandler, "auth.UserProfileFetchHandler", http.MethodGet)
	functionRegisterHandler("/api/update-profile", auth.UserProfileUpdateHandler, "auth.UserProfileUpdateHandler", http.MethodPost)
	functionRegisterHandler("/api/user-visual-preference", auth.UserVisualPreferenceHandler, "auth.UserVisualPreferenceHandler", http.MethodGet, http.MethodPatch, http.MethodDelete)
	functionRegisterHandler("/api/request-email-change-otp", auth.RequestEmailChangeOTPHandler, "auth.RequestEmailChangeOTPHandler", http.MethodPost)
	functionRegisterHandler("/api/request-password-change-otp", auth.RequestPasswordChangeOTPHandler, "auth.RequestPasswordChangeOTPHandler", http.MethodPost)
	functionRegisterHandler("/api/admin/user-authentication", auth.AdminUserAuthenticationHandler, "auth.AdminUserAuthenticationHandler", http.MethodGet, http.MethodPost)
	functionRegisterHandler("/api/admin/lang-key", lang.AdminLangKeyHandler, "lang.AdminLangKeyHandler", http.MethodPost)
	functionRegisterHandler("/api/admin/symbols", symbol_registry.AdminHandler, "symbol_registry.AdminHandler", http.MethodGet, http.MethodPost)
	functionRegisterHandler("/api/admin/ui-feature-flags", system_table_tools.GetAdminUIFeatureFlagsHandler, "system_table_tools.GetAdminUIFeatureFlagsHandler", http.MethodGet)
	functionRegisterHandler("/api/site-presentation-settings", system_table_tools.GetSitePresentationSettingsHandler, "system_table_tools.GetSitePresentationSettingsHandler", http.MethodGet)
	functionRegisterHandler("/api/admin/site-presentation-settings", system_table_tools.AdminSitePresentationSettingsHandler, "system_table_tools.AdminSitePresentationSettingsHandler", http.MethodGet, http.MethodPost)
	functionRegisterHandler("/api/admin/row-groups", system_table_tools.AdminRowGroupsHandler, "system_table_tools.AdminRowGroupsHandler", http.MethodGet, http.MethodPost)
	functionRegisterHandler("/api/admin/row-group-memberships", system_table_tools.AdminRowGroupMembershipsHandler, "system_table_tools.AdminRowGroupMembershipsHandler", http.MethodPost, http.MethodDelete)
	functionRegisterHandler("/api/admin/row-access-rules", system_table_tools.AdminRowAccessRulesHandler, "system_table_tools.AdminRowAccessRulesHandler", http.MethodGet, http.MethodPost)
	functionRegisterHandler("/api/image-source-picker/providers", image_source_picker.ProvidersHandler, "image_source_picker.ProvidersHandler", http.MethodGet)
	functionRegisterHandler("/api/image-source-picker/resolve", image_source_picker.ResolveHandler, "image_source_picker.ResolveHandler", http.MethodPost)
	functionRegisterHandler("/api/image-source-picker/file", image_source_picker.FileHandler, "image_source_picker.FileHandler", http.MethodPost)

	// DevTools-reitit (vain eksplisiittisessä kehitysympäristössä)
	envType := os.Getenv("ENVIRONMENT_TYPE")
	isDevEnvironment := envType == "dev"
	if isDevEnvironment {
		const devOnlyCondition = "ENVIRONMENT_TYPE='dev'"
		functionRegisterConditionalHandler("/api/sessioninfo", devtools.SessionHandler, "devtools.SessionHandler", devOnlyCondition, http.MethodGet)
		functionRegisterConditionalHandler("/api/export-table-csv", devtools.ExportTableCSVHandler, "devtools.ExportTableCSVHandler", devOnlyCondition, http.MethodGet)
		functionRegisterConditionalHandler("/api/import-table-csv", devtools.ImportTableCSVHandler, "devtools.ImportTableCSVHandler", devOnlyCondition, http.MethodPost)
		functionRegisterConditionalHandler("/api/check-json-columns", devtools.CheckJsonInTextColumnsHandler, "devtools.CheckJsonInTextColumnsHandler", devOnlyCondition, http.MethodGet)
		functionRegisterConditionalHandler("/api/log-client-error", devtools.LogClientError, "devtools.LogClientError", devOnlyCondition, http.MethodPost)
		functionRegisterConditionalHandler("/api/pipeline-info", pipeline.IntrospectionHandler, "pipeline.IntrospectionHandler", devOnlyCondition, http.MethodGet)
		functionRegisterConditionalHandler("/api/update-lang-key", lang.UpdateLangKeyHandler, "lang.UpdateLangKeyHandler", devOnlyCondition, http.MethodPost)
		functionRegisterConditionalHandler("/api/dev-ai-translate-single", lang.AiTranslateSingleHandler, "lang.AiTranslateSingleHandler", devOnlyCondition, http.MethodPost)
	} else {
		log.Printf("Skipping dev tool route registration because ENVIRONMENT_TYPE=%q", envType)
	}

	// Access-kontrolloidut dtt- ja system_table_tools -reitit
	functionRegisterHandler("/api/add_foreign_key", dtt_foreign_keys.AddForeignKeyHandler, "dtt_foreign_keys.AddForeignKeyHandler", http.MethodPost)
	functionRegisterHandler("/api/delete_foreign_key", dtt_foreign_keys.DeleteForeignKeyHandler, "dtt_foreign_keys.DeleteForeignKeyHandler", http.MethodPost)
	functionRegisterHandler("/api/foreign_keys", dtt_foreign_keys.GetForeignKeys, "dtt_foreign_keys.GetForeignKeys", http.MethodGet)
	functionRegisterHandler("/api/dataset-names", dtt_foreign_keys.GetTableNamesHandler, "dtt_foreign_keys.GetTableNamesHandler", http.MethodGet)
	functionRegisterHandler("/api/dataset-aliases", GetDatasetAliasesHandler, "router.GetDatasetAliasesHandler", http.MethodGet)
	functionRegisterHandler("/api/dataset-alias-management", GetDatasetAliasManagementHandler, "router.GetDatasetAliasManagementHandler", http.MethodGet)
	functionRegisterHandler("/api/dataset-alias-management/save", SaveDatasetAliasManagementHandler, "router.SaveDatasetAliasManagementHandler", http.MethodPost)
	functionRegisterHandler("/api/asset-linking/images/enable", dtt_asset_linking.EnableImageAssetLinkingHandler, "dtt_asset_linking.EnableImageAssetLinkingHandler", http.MethodPost)
	functionRegisterHandler("/api/asset-linking/images/disable", dtt_asset_linking.DisableImageAssetLinkingHandler, "dtt_asset_linking.DisableImageAssetLinkingHandler", http.MethodPost)
	functionRegisterHandler("/api/asset-linking/images/remove", dtt_asset_linking.RemoveImageAssetLinkingHandler, "dtt_asset_linking.RemoveImageAssetLinkingHandler", http.MethodPost)
	functionRegisterHandler("/api/asset-linking/images/status", dtt_asset_linking.GetImageAssetLinkingStatusHandler, "dtt_asset_linking.GetImageAssetLinkingStatusHandler", http.MethodGet)
	functionRegisterHandler("/api/asset-linking/images/update", dtt_asset_linking.UpdateImageAssetLinkingHandler, "dtt_asset_linking.UpdateImageAssetLinkingHandler", http.MethodPost)
	functionRegisterHandler("/api/asset-linking/attachments/enable", dtt_asset_linking.EnableAttachmentLinkingHandler, "dtt_asset_linking.EnableAttachmentLinkingHandler", http.MethodPost)
	functionRegisterHandler("/api/asset-linking/attachments/disable", dtt_asset_linking.DisableAttachmentLinkingHandler, "dtt_asset_linking.DisableAttachmentLinkingHandler", http.MethodPost)
	functionRegisterHandler("/api/asset-linking/attachments/remove", dtt_asset_linking.RemoveAttachmentLinkingHandler, "dtt_asset_linking.RemoveAttachmentLinkingHandler", http.MethodPost)
	functionRegisterHandler("/api/asset-linking/attachments/status", dtt_asset_linking.GetAttachmentLinkingStatusHandler, "dtt_asset_linking.GetAttachmentLinkingStatusHandler", http.MethodGet)
	functionRegisterHandler("/api/asset-linking/status", dtt_asset_linking.GetAssetLinkingStatusHandler, "dtt_asset_linking.GetAssetLinkingStatusHandler", http.MethodGet)
	functionRegisterHandler("/api/embedding-datasets", ai_features.GetEmbeddingDatasetsHandler, "ai_features.GetEmbeddingDatasetsHandler", http.MethodGet)
	functionRegisterHandler("/api/admin/embedding-source-policy", ai_features.ExternalEmbeddingSourcePolicyHandler, "ai_features.ExternalEmbeddingSourcePolicyHandler", http.MethodGet, http.MethodPost)
	functionRegisterHandler("/api/admin/ui-languages", lang.AdminUILanguagesHandler, "lang.AdminUILanguagesHandler", http.MethodGet, http.MethodPost)
	functionRegisterHandler("/api/admin/dataset-ui-visibility", system_table_tools.AdminDatasetUIVisibilityHandler, "system_table_tools.AdminDatasetUIVisibilityHandler", http.MethodGet, http.MethodPost)
	functionRegisterHandler("/api/admin/column-multilingual", system_table_tools.UpdateColumnMultilingualHandler, "system_table_tools.UpdateColumnMultilingualHandler", http.MethodPost)
	functionRegisterHandler("/api/admin/column-insertable", system_table_tools.UpdateColumnInsertableHandler, "system_table_tools.UpdateColumnInsertableHandler", http.MethodPost)
	functionRegisterHandler("/api/dataset_permissions", backend.PermissionsHandler, "backend.PermissionsHandler", http.MethodGet, http.MethodPost, http.MethodPatch)
	functionRegisterHandler("/api/datasets", system_table_tools.GetGroupedTables, "system_table_tools.GetGroupedTables", http.MethodGet)
	functionRegisterHandler("/api/update-oids", system_table_tools.HandleUpdateOidsAndTableNames, "system_table_tools.HandleUpdateOidsAndTableNames", http.MethodPost)
	functionRegisterHandler("/api/empty-rows", system_table_tools.GetEmptyRowsHandler, "system_table_tools.GetEmptyRowsHandler", http.MethodGet)
	functionRegisterHandler("/api/check-media-tables", system_table_tools.CheckMediaTableFoldersHandler, "system_table_tools.CheckMediaTableFoldersHandler", http.MethodGet)
	functionRegisterHandler("/api/archive-media-tables", system_table_tools.ArchiveMediaTableFoldersHandler, "system_table_tools.ArchiveMediaTableFoldersHandler", http.MethodPost)
	functionRegisterHandler("/api/check-archived-media-tables", system_table_tools.CheckArchivedMediaTableFoldersHandler, "system_table_tools.CheckArchivedMediaTableFoldersHandler", http.MethodGet)
	functionRegisterHandler("/api/prune-archived-media-tables", system_table_tools.PruneArchivedMediaTableFoldersHandler, "system_table_tools.PruneArchivedMediaTableFoldersHandler", http.MethodPost)
	functionRegisterHandler("/api/check-media-rows", system_table_tools.CheckMediaRowFoldersHandler, "system_table_tools.CheckMediaRowFoldersHandler", http.MethodGet)
	functionRegisterHandler("/api/check-media-subfolders", system_table_tools.CheckMediaSubfoldersHandler, "system_table_tools.CheckMediaSubfoldersHandler", http.MethodGet)
	functionRegisterHandler("/api/fix-media-subfolders", system_table_tools.FixMediaSubfoldersHandler, "system_table_tools.FixMediaSubfoldersHandler", http.MethodPost)
	functionRegisterHandler("/api/check-db-consistency", system_table_tools.CheckDatabaseConsistencyHandler, "system_table_tools.CheckDatabaseConsistencyHandler", http.MethodGet)
	functionRegisterHandler("/api/fix-db-consistency", system_table_tools.FixDatabaseConsistencyHandler, "system_table_tools.FixDatabaseConsistencyHandler", http.MethodPost)
	functionRegisterHandler("/api/log-retention/preview", system_table_tools.PreviewLogRetentionHandler, "system_table_tools.PreviewLogRetentionHandler", http.MethodGet)
	functionRegisterHandler("/api/log-retention/prune", system_table_tools.PruneLogRetentionHandler, "system_table_tools.PruneLogRetentionHandler", http.MethodPost)
	functionRegisterHandler("/api/data-retention/preview", system_table_tools.PreviewDataRetentionHandler, "system_table_tools.PreviewDataRetentionHandler", http.MethodGet)
	functionRegisterHandler("/api/data-retention/prune", system_table_tools.PruneDataRetentionHandler, "system_table_tools.PruneDataRetentionHandler", http.MethodPost)
	functionRegisterHandler("/api/scan-lang-sources", system_table_tools.ScanLangSourcesHandler, "system_table_tools.ScanLangSourcesHandler", http.MethodPost)
	functionRegisterHandler("/api/fk-cache-triggers", system_table_tools.ListFKCacheTriggersHandler, "system_table_tools.ListFKCacheTriggersHandler", http.MethodGet)
	functionRegisterHandler("/api/fk-cache-refresh", system_table_tools.RefreshFKCacheHandler, "system_table_tools.RefreshFKCacheHandler", http.MethodPost)
	functionRegisterHandler("/api/update-tab-order", system_table_tools.UpdateTabOrderHandler, "system_table_tools.UpdateTabOrderHandler", http.MethodPost)
	functionRegisterHandler("/api/card-visibility/update", system_table_tools.UpdateCardVisibilityHandler, "system_table_tools.UpdateCardVisibilityHandler", http.MethodPost)
	functionRegisterHandler("/api/card-visibility/", system_table_tools.GetCardVisibilityHandler, "system_table_tools.GetCardVisibilityHandler", http.MethodGet)
	functionRegisterHandler("/api/dataset-header-config/save", system_table_tools.SaveDatasetHeaderConfigHandler, "system_table_tools.SaveDatasetHeaderConfigHandler", http.MethodPost)
	functionRegisterHandler("/api/dataset-header-config/", system_table_tools.GetDatasetHeaderConfigHandler, "system_table_tools.GetDatasetHeaderConfigHandler", http.MethodGet)
	functionRegisterHandler("/api/child-tab-config/save", system_table_tools.SaveChildTabConfigHandler, "system_table_tools.SaveChildTabConfigHandler", http.MethodPost)
	functionRegisterHandler("/api/child-tab-config/", system_table_tools.GetChildTabConfigHandler, "system_table_tools.GetChildTabConfigHandler", http.MethodGet)
	functionRegisterHandler("/api/view-field-sets", system_table_tools.GetViewFieldSetsHandler, "system_table_tools.GetViewFieldSetsHandler", http.MethodGet)
	functionRegisterHandler("/api/view-field-settings/article-section-defaults", system_table_tools.GetArticleSectionDefaultsHandler, "system_table_tools.GetArticleSectionDefaultsHandler", http.MethodGet)
	functionRegisterHandler("/api/admin/view-field-settings/article-section-defaults", system_table_tools.SaveArticleSectionDefaultsHandler, "system_table_tools.SaveArticleSectionDefaultsHandler", http.MethodPost)
	functionRegisterHandler("/api/view-field-sets/personal/save", system_table_tools.SavePersonalViewFieldSetHandler, "system_table_tools.SavePersonalViewFieldSetHandler", http.MethodPost)
	functionRegisterHandler("/api/view-field-sets/personal/assign", system_table_tools.AssignPersonalViewFieldSetHandler, "system_table_tools.AssignPersonalViewFieldSetHandler", http.MethodPost)
	functionRegisterHandler("/api/view-field-sets/personal/reset", system_table_tools.ResetPersonalViewFieldSetHandler, "system_table_tools.ResetPersonalViewFieldSetHandler", http.MethodPost)
	functionRegisterHandler("/api/view-field-sets/personal/delete", system_table_tools.DeletePersonalViewFieldSetHandler, "system_table_tools.DeletePersonalViewFieldSetHandler", http.MethodPost)
	functionRegisterHandler("/api/admin/view-field-sets/site/save", system_table_tools.SaveSiteViewFieldSetHandler, "system_table_tools.SaveSiteViewFieldSetHandler", http.MethodPost)
	functionRegisterHandler("/api/admin/view-field-sets/site/assign", system_table_tools.AssignSiteViewFieldSetHandler, "system_table_tools.AssignSiteViewFieldSetHandler", http.MethodPost)
	functionRegisterHandler("/api/admin/view-field-sets/shared/reset", system_table_tools.ResetSharedViewFieldSetHandler, "system_table_tools.ResetSharedViewFieldSetHandler", http.MethodPost)
	functionRegisterHandler("/api/admin/view-field-sets/shared/delete", system_table_tools.DeleteSharedViewFieldSetHandler, "system_table_tools.DeleteSharedViewFieldSetHandler", http.MethodPost)
	functionRegisterHandler("/api/filterbar-section-layout/save", system_table_tools.SaveFilterbarSectionLayoutHandler, "system_table_tools.SaveFilterbarSectionLayoutHandler", http.MethodPost)
	functionRegisterHandler("/api/filterbar-section-layout", system_table_tools.GetFilterbarSectionLayoutHandler, "system_table_tools.GetFilterbarSectionLayoutHandler", http.MethodGet)
	functionRegisterHandler("/api/dataset-sort-default", system_table_tools.GetDatasetSortDefaultHandler, "system_table_tools.GetDatasetSortDefaultHandler", http.MethodGet)
	functionRegisterHandler("/api/dataset-sort-default/personal", system_table_tools.SavePersonalDatasetSortDefaultHandler, "system_table_tools.SavePersonalDatasetSortDefaultHandler", http.MethodPost)
	functionRegisterHandler("/api/admin/dataset-sort-default", system_table_tools.SaveDatasetSortDefaultHandler, "system_table_tools.SaveDatasetSortDefaultHandler", http.MethodPost)
	functionRegisterHandler("/api/task-todo-progress", system_table_tools.GetTaskTodoProgressHandler, "system_table_tools.GetTaskTodoProgressHandler", http.MethodGet)

	// dtt_1_row_create
	functionRegisterHandler("/api/add-row-multipart", dtt_1_row_create.AddRowMultipartHandlerWrapper, "dtt_1_row_create.AddRowMultipartHandlerWrapper", http.MethodPost)
	functionRegisterHandler("/api/geocode-address", dtt_1_row_create.GeocodeAddressHandler, "dtt_1_row_create.GeocodeAddressHandler", http.MethodPost)
	functionRegisterHandler("/api/get-1m-relations", dtt_1_row_create.GetOneToManyRelationsHandlerWrapper, "dtt_1_row_create.GetOneToManyRelationsHandlerWrapper", http.MethodGet)
	functionRegisterHandler("/api/get-add-row-metadata", dtt_1_row_create.GetAddRowMetadataHandlerWrapper, "dtt_1_row_create.GetAddRowMetadataHandlerWrapper", http.MethodGet)
	functionRegisterHandler("/api/get-columns", dtt_1_row_create.GetAddRowColumnsHandlerWrapper, "dtt_1_row_create.GetAddRowColumnsHandlerWrapper", http.MethodGet)
	functionRegisterHandler("/api/get-many-to-many", dtt_1_row_create.GetManyToManyTablesHandlerWrapper, "dtt_1_row_create.GetManyToManyTablesHandlerWrapper", http.MethodGet)
	functionRegisterHandler("/api/referenced-data", dtt_1_row_create.GetReferencedTableData, "dtt_1_row_create.GetReferencedTableData", http.MethodGet)

	// dtt_1_row_delete
	functionRegisterHandler("/api/delete-rows", dtt_1_row_delete.DeleteRowsHandlerWrapper, "dtt_1_row_delete.DeleteRowsHandlerWrapper", http.MethodPost)

	// dtt_3_table_crud
	// Table CRUD
	functionRegisterHandler("/api/drop-dataset", dtt_3_table_delete.DropTableHandler, "dtt_3_table_delete.DropTableHandler", http.MethodPost)
	functionRegisterHandler("/api/get-metadata", dtt_3_table_read.GetTableViewHandlerWrapper, "dtt_3_table_read.GetTableViewHandlerWrapper", http.MethodGet)

	// dtt_1_row_read
	functionRegisterHandler("/api/fetch-dynamic-children", dtt_1_row_read.GetDynamicChildItemsHandler, "dtt_1_row_read.GetDynamicChildItemsHandler", http.MethodPost)
	functionRegisterHandler("/api/comments", dtt_1_row_read.CommentListHandler, "dtt_1_row_read.CommentListHandler", http.MethodGet)
	functionRegisterHandler("/api/comments/create", dtt_1_row_read.CommentCreateHandler, "dtt_1_row_read.CommentCreateHandler", http.MethodPost)
	functionRegisterHandler("/api/comments/delete", dtt_1_row_read.CommentDeleteHandler, "dtt_1_row_read.CommentDeleteHandler", http.MethodDelete)
	functionRegisterHandler("/api/comment-counts", dtt_1_row_read.CommentCountHandler, "dtt_1_row_read.CommentCountHandler", http.MethodPost)
	functionRegisterHandler("/api/get-intelligent-results", dtt_1_row_read.GetIntelligentResultsHandlerWrapper, "dtt_1_row_read.GetIntelligentResultsHandlerWrapper", http.MethodGet)
	functionRegisterHandler("/api/get-filter-options", dtt_1_row_read.GetFilterOptionsHandler, "dtt_1_row_read.GetFilterOptionsHandler", http.MethodGet)
	functionRegisterHandler("/api/get-results", dtt_1_row_read.GetResultsHandlerWrapper, "dtt_1_row_read.GetResultsHandlerWrapper", http.MethodGet)
	functionRegisterHandler("/api/get-results-vector", dtt_1_row_read.GetResultsVector, "dtt_1_row_read.GetResultsVector", http.MethodGet)
	functionRegisterHandler("/api/get-row-count", dtt_1_row_read.GetRowCountHandlerWrapper, "dtt_1_row_read.GetRowCountHandlerWrapper", http.MethodGet)

	functionRegisterHandler("/api/system_triggers/create", dtt_triggers.CreateTriggerHandler, "dtt_triggers.CreateTriggerHandler", http.MethodPost)
	functionRegisterHandler("/api/system_triggers/list", dtt_triggers.GetTriggersHandler, "dtt_triggers.GetTriggersHandler", http.MethodGet)
	functionRegisterHandler("/api/dataset-columns/", dtt_2_column_crud.GetTableColumnsHandler, "dtt_2_column_crud.GetTableColumnsHandler", http.MethodGet)
	functionRegisterHandler("/api/update-row", dtt_1_row_update.UpdateRowHandlerWrapper, "dtt_1_row_update.UpdateRowHandlerWrapper", http.MethodPost)

	// Muut reitit
	functionRegisterHandler("/api/update-folder", dtt_system_table_folders.HandleUpdateFolder, "dtt_system_table_folders.HandleUpdateFolder", http.MethodPost)
	functionRegisterHandler("/api/update-table-folder", dtt_system_table_folders.HandleUpdateTableFolder, "dtt_system_table_folders.HandleUpdateTableFolder", http.MethodPost)
	functionRegisterHandler("/api/set-current-project-folder", dtt_system_table_folders.HandleSetCurrentProjectFolder, "dtt_system_table_folders.HandleSetCurrentProjectFolder", http.MethodPost)
	functionRegisterHandler("/api/create-folder", dtt_system_table_folders.HandleCreateFolder, "dtt_system_table_folders.HandleCreateFolder", http.MethodPost)
	functionRegisterHandler("/api/delete-folder", dtt_system_table_folders.HandleDeleteFolder, "dtt_system_table_folders.HandleDeleteFolder", http.MethodPost)
	functionRegisterHandler("/api/rename-tree-node", dtt_system_table_folders.HandleRenameTreeNode, "dtt_system_table_folders.HandleRenameTreeNode", http.MethodPost)
	if os.Getenv("ENABLE_API_LANGUAGE") == "true" {
		const apiLanguageCondition = "ENABLE_API_LANGUAGE=true"
		log.Printf("Registering /api/create-table because ENABLE_API_LANGUAGE=true")
		functionRegisterConditionalHandler("/api/create-table", dtt_crud_workflows.SimpleCreateTableHandler, "dtt_crud_workflows.SimpleCreateTableHandler", apiLanguageCondition, http.MethodPost)
		log.Printf("Registering /api/query-table because ENABLE_API_LANGUAGE=true")
		functionRegisterConditionalHandler("/api/query-table", dtt_crud_workflows.SimpleQueryTableHandler, "dtt_crud_workflows.SimpleQueryTableHandler", apiLanguageCondition, http.MethodPost)
	} else {
		log.Printf("Not registering /api/create-table because ENABLE_API_LANGUAGE=%s", os.Getenv("ENABLE_API_LANGUAGE"))
	}
	functionRegisterHandler("/api/create_dataset", dtt_crud_workflows.CreateTableHandler, "dtt_crud_workflows.CreateTableHandler", http.MethodPost)
	functionRegisterHandler("/api/generateTranslations", lang.GenerateTranslationsHandler, "lang.GenerateTranslationsHandler", http.MethodPost)
	functionRegisterHandler("/api/fix-translations", lang.FixTableTranslationsHandler, "lang.FixTableTranslationsHandler", http.MethodPost)
	functionRegisterHandler("/api/modify-columns", dtt_crud_workflows.ModifyColumnsHandler, "dtt_crud_workflows.ModifyColumnsHandler", http.MethodGet, http.MethodPost)
	functionRegisterHandler("/api/set-comments", dtt_crud_workflows.SetCommentsHandler, "dtt_crud_workflows.SetCommentsHandler", http.MethodPost)
	functionRegisterHandler("/api/create-indexes", dtt_crud_workflows.CreateIndexesHandler, "dtt_crud_workflows.CreateIndexesHandler", http.MethodPost)
	functionRegisterHandler("/api/embedding_stream_handler", ai_features.EmbeddingStreamHandler, "ai_features.EmbeddingStreamHandler", http.MethodGet)
	functionRegisterHandler("/api/sse/subscribe", event_bus.SSESubscribeHandler, "event_bus.SSESubscribeHandler", http.MethodGet)
	functionRegisterHandler("/api/refresh-lang-embeddings", ai_features.RefreshLangEmbeddingsHandler, "ai_features.RefreshLangEmbeddingsHandler", http.MethodPost)
	functionRegisterHandler("/api/count-lang-embeddings", ai_features.CountLangEmbeddingsHandler, "ai_features.CountLangEmbeddingsHandler", http.MethodPost)
	functionRegisterHandler("/api/text-index-status", dtt_search_vectors.TextIndexStatusHandler, "dtt_search_vectors.TextIndexStatusHandler", http.MethodGet)
	functionRegisterHandler("/api/rebuild-search-vectors", dtt_search_vectors.RebuildSearchVectorHandler, "dtt_search_vectors.RebuildSearchVectorHandler", http.MethodPost)
	functionRegisterHandler("/api/save-usergroup-right", backend.SaveUserGroupRight, "backend.SaveUserGroupRight", http.MethodPost)

	// DB Role Management (admin-only, non-table-specific)
	functionRegisterHandler("/api/db-roles", db_admin.ListRolesHandler, "db_admin.ListRolesHandler", http.MethodGet)
	functionRegisterHandler("/api/db-roles/create", db_admin.CreateRoleHandler, "db_admin.CreateRoleHandler", http.MethodPost)
	functionRegisterHandler("/api/db-roles/update", db_admin.UpdateRoleHandler, "db_admin.UpdateRoleHandler", http.MethodPost)
	functionRegisterHandler("/api/db-roles/delete", db_admin.DeleteRoleHandler, "db_admin.DeleteRoleHandler", http.MethodPost)
	functionRegisterHandler("/api/translations", lang.GetTranslationsHandler, "lang.GetTranslationsHandler", http.MethodGet)
	functionRegisterHandler("/api/ui-languages", lang.GetPublicUILanguagesHandler, "lang.GetPublicUILanguagesHandler", http.MethodGet)
	functionRegisterHandler("/api/get-lang-key-translations", lang.GetLangKeyTranslationsHandler, "lang.GetLangKeyTranslationsHandler", http.MethodGet)
	functionRegisterHandler("/api/about", system_table_tools.GetAboutRowHandler, "system_table_tools.GetAboutRowHandler", http.MethodGet)
	functionRegisterHandler("/api/user-permissions", auth.UserPermissionsHandler, "auth.UserPermissionsHandler", http.MethodGet)
	functionRegisterHandler("/api/check-table-right", auth.CheckTableRightHandler, "auth.CheckTableRightHandler", http.MethodGet)
	functionRegisterHandler("/api/check-table-rights", auth.CheckTableRightsHandler, "auth.CheckTableRightsHandler", http.MethodPost)
	functionRegisterHandler("/api/check-table-rights-multi", auth.CheckTableRightsMultiHandler, "auth.CheckTableRightsMultiHandler", http.MethodPost)
	functionRegisterHandler("/api/tree_data", vanilla_tree.GetTreeDataHandler, "vanilla_tree.GetTreeDataHandler", http.MethodGet)
	functionRegisterHandler("/api/get-view-data", vanilla_tree.GetViewDataHandler, "vanilla_tree.GetViewDataHandler", http.MethodGet)

	// Register optional private maintainer routes outside apps/.
	RegisterMaintainerToolRoutes()

	// Register application routes (apps)
	RegisterAppRoutes()
}

// RegisterFrontendDirectory mounts a disjoint extension directory below the
// public frontend URL space. It preserves the same public static-file pipeline
// as core frontend assets without mixing private source into the core tree.
func RegisterFrontendDirectory(urlPrefix string, directory string) error {
	if !strings.HasPrefix(urlPrefix, "/frontend/") ||
		!strings.HasSuffix(urlPrefix, "/") ||
		urlPrefix == "/frontend/" ||
		path.Clean(urlPrefix)+"/" != urlPrefix {
		return fmt.Errorf(
			"frontend extension URL prefix must be a normalized child of /frontend/ ending in /",
		)
	}
	absoluteDirectory, err := filepath.Abs(directory)
	if err != nil {
		return fmt.Errorf("resolve frontend extension directory: %w", err)
	}
	info, err := os.Stat(absoluteDirectory)
	if err != nil {
		return fmt.Errorf("frontend extension directory %q: %w", absoluteDirectory, err)
	}
	if !info.IsDir() {
		return fmt.Errorf("frontend extension directory %q is not a directory", absoluteDirectory)
	}

	fileServer := http.StripPrefix(
		urlPrefix,
		frontendassets.FileServer(absoluteDirectory),
	)
	functionRegisterHandler(
		urlPrefix,
		fileServer.ServeHTTP,
		"router.handleFrontend",
		http.MethodGet,
	)
	return nil
}

// ResetRouteDefinitions clears the in-memory route registry before a fresh
// registration pass. Tests and generators use this to avoid append-only drift.
func ResetRouteDefinitions() {
	routeDefinitions = nil
}

// GetRouteDefinitions returns the registered route definitions for testing and introspection.
func GetRouteDefinitions() []RouteDefinition {
	definitions := make([]RouteDefinition, len(routeDefinitions))
	copy(definitions, routeDefinitions)
	for index := range definitions {
		definitions[index].Methods = append([]string(nil), definitions[index].Methods...)
	}
	return definitions
}

// functionRegisterHandler lisää reittitietueen muistiin (EI tee http.HandleFunc vielä)
func functionRegisterHandler(urlPattern string, handlerFunc http.HandlerFunc, handlerName string, methods ...string) {
	functionRegisterConditionalHandler(urlPattern, handlerFunc, handlerName, "", methods...)
}

func functionRegisterConditionalHandler(urlPattern string, handlerFunc http.HandlerFunc, handlerName string, conditionalSource string, methods ...string) {
	methodContract := newRouteMethodContract(methods...)
	routeDefinitions = append(routeDefinitions, RouteDefinition{
		UrlPattern:        urlPattern,
		MatchType:         routeMatchTypeForPattern(urlPattern),
		HandlerFunc:       enforceRouteMethods(handlerFunc, handlerName, methodContract),
		HandlerName:       handlerName,
		Methods:           append([]string(nil), methodContract.Methods...),
		MethodSource:      methodContract.Source,
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
