// route_profiles.go
// Maps handler names to their pipeline security profiles (Public, LoginOnly, Admin, Default).
// Bridges route registration and the pipeline stage selector with per-route configuration.
// Exists to replace scattered map literals with a unified profile lookup for each handler.
// GetProfile falls back to DefaultProfile, but registered routes should still
// have explicit entries so security decisions stay auditable.
//
// To add a special profile for a new route, add ONE entry to RouteProfiles.
package pipeline

import (
	"os"
	"sort"
)

// ──────────────────────────────────────────────────────────────
// Reusable profile templates
// ──────────────────────────────────────────────────────────────

// publicSkips is the set of stages that public routes skip.
var publicSkips = map[string]bool{
	"auth":           true,
	"csrf":           true,
	"fingerprint":    true,
	"device_id":      true,
	"access_control": true,
	"admin_check":    true,
}

// loginOnlySkips skips permission and admin checks but keeps auth stages.
var loginOnlySkips = map[string]bool{
	"access_control": true,
	"admin_check":    true,
}

// accessControlNoTxSkips keeps table ACL checks enabled while skipping admin and transaction stages.
var accessControlNoTxSkips = map[string]bool{
	"admin_check": true,
	"transaction": true,
}

// PublicProfile is for routes that need no authentication at all.
var PublicProfile = RouteProfile{
	SkipStages: publicSkips,
}

// StorageProfile skips generic table inference because ServeStorage authorizes
// row-scoped files from the storage path and only allowlists known public assets.
var StorageProfile = RouteProfile{
	SkipStages: publicSkips,
}

// LoginOnlyProfile requires login but no function/table-level permissions.
var LoginOnlyProfile = RouteProfile{
	SkipStages: loginOnlySkips,
}

// AccessControlNoTxProfile keeps access_control enabled but avoids long-lived request transactions.
var AccessControlNoTxProfile = RouteProfile{
	SkipStages: accessControlNoTxSkips,
}

// AdminProfile requires full access control PLUS admin_access_allowed flag.
var AdminProfile = RouteProfile{
	SkipStages: map[string]bool{},
	AdminOnly:  true,
}

// ──────────────────────────────────────────────────────────────
// RouteProfiles maps each handler name to its pipeline profile.
// Routes not listed here get DefaultProfile (all stages active).
// ──────────────────────────────────────────────────────────────

// RouteProfiles is the single source of truth for per-route pipeline configuration.
var RouteProfiles = map[string]RouteProfile{

	// ── Public routes (no auth required) ──────────────────────

	// Static / navigation
	"router.faviconHandler":              PublicProfile,
	"router.robotsHandler":               PublicProfile,
	"router.healthHandler":               PublicProfile,
	"router.systemHealthHandler":         PublicProfile,
	"router.systemReadyHandler":          PublicProfile,
	"router.systemInstanceStatusHandler": PublicProfile,
	"router.systemDrainHandler":          PublicProfile,
	"router.sitemapHandler":              PublicProfile,
	"router.rootHandler":                 PublicProfile,
	"router.handleFrontend":              PublicProfile,
	"router.handleApps":                  PublicProfile,
	"router.ServeStorage":                StorageProfile,
	"router.datasetsRedirectHandler":     PublicProfile,

	// Auth endpoints (must be accessible before login)
	"auth.LoginHandler":                   PublicProfile,
	"auth.LoginAPIHandler":                PublicProfile,
	"auth.FirstRunAdminHandler":           PublicProfile,
	"auth.RequestPasswordResetOTPHandler": PublicProfile,
	"auth.ResetPasswordWithOTPHandler":    PublicProfile,
	"auth.RegisterHandler":                PublicProfile,
	"auth.RegisterAPIHandler":             PublicProfile,
	"auth.LogoutHandler":                  PublicProfile,
	"auth.CSRFTokenHandler":               PublicProfile,
	"auth.GetAuthModesHandler":            PublicProfile,
	"auth.CheckFingerprintHandler":        PublicProfile,
	"product_identity.Handler":            PublicProfile,

	// Session management
	"e_sessions.ResetSessionHandler": PublicProfile,

	// Public data endpoints
	"lang.GetTranslationsHandler":           PublicProfile,
	"system_table_tools.GetAboutRowHandler": PublicProfile, // login page fetches privacy policy

	// Dev tools — registered conditionally in init() below

	// External webhooks (use their own auth mechanisms)
	"payment_gateway.CreatePaymentHandler":    PublicProfile, // App-level auth
	"payment_gateway.WebhookHandler":          PublicProfile, // Revolut webhook
	"payment_gateway.GetPaymentStatusHandler": PublicProfile, // Token auth

	// ── Login-only routes (auth required, no permission check) ──

	"auth.CheckTableRightHandler":                   LoginOnlyProfile,
	"auth.CheckTableRightsHandler":                  LoginOnlyProfile,
	"auth.CheckTableRightsMultiHandler":             LoginOnlyProfile,
	"auth.UserProfileFetchHandler":                  LoginOnlyProfile,
	"auth.UserProfileUpdateHandler":                 LoginOnlyProfile,
	"auth.UserPermissionsHandler":                   LoginOnlyProfile, // User's own permissions — no table-level check needed
	"auth.RequestEmailChangeOTPHandler":             LoginOnlyProfile, // Sends OTP for email change; user-owned operation, no table permissions needed
	"auth.RequestPasswordChangeOTPHandler":          LoginOnlyProfile, // Sends OTP for password change; user-owned operation, no table permissions needed
	"router.adminHandler":                           AdminProfile,
	"dtt_1_row_read.FilterbarAIConversationHandler": LoginOnlyProfile,

	// ── Admin-only routes (full access control + admin flag) ──

	// Tab ordering
	"system_table_tools.UpdateTabOrderHandler": AdminProfile,
	"router.adminVersionInfoHandler":           AdminProfile,
	"router.saveOpenAIAPIKeyHandler":           AdminProfile,

	// DEV-only local AI tooling
	"dtt_1_row_read.FilterbarAICodexQueryHandler": AdminProfile,

	// Database administration
	"system_table_tools.FixDatabaseConsistencyHandler":         AdminProfile,
	"system_table_tools.CheckDatabaseConsistencyHandler":       AdminProfile,
	"system_table_tools.PreviewLogRetentionHandler":            AdminProfile,
	"system_table_tools.PruneLogRetentionHandler":              AdminProfile,
	"system_table_tools.PreviewDataRetentionHandler":           AdminProfile,
	"system_table_tools.PruneDataRetentionHandler":             AdminProfile,
	"system_table_tools.ScanLangSourcesHandler":                AdminProfile,
	"system_table_tools.HandleUpdateOidsAndTableNames":         AdminProfile,
	"system_table_tools.FixMediaSubfoldersHandler":             AdminProfile,
	"system_table_tools.CheckMediaTableFoldersHandler":         AdminProfile,
	"system_table_tools.ArchiveMediaTableFoldersHandler":       AdminProfile,
	"system_table_tools.CheckArchivedMediaTableFoldersHandler": AdminProfile,
	"system_table_tools.PruneArchivedMediaTableFoldersHandler": AdminProfile,
	"system_table_tools.CheckMediaRowFoldersHandler":           AdminProfile,
	"system_table_tools.CheckMediaSubfoldersHandler":           AdminProfile,
	"system_table_tools.ListFKCacheTriggersHandler":            AdminProfile,
	"system_table_tools.RefreshFKCacheHandler":                 AdminProfile,
	"system_table_tools.GetCardVisibilityHandler":              AdminProfile,
	"system_table_tools.UpdateCardVisibilityHandler":           AdminProfile,
	"system_table_tools.GetDatasetHeaderConfigHandler":         AdminProfile,
	"system_table_tools.SaveDatasetHeaderConfigHandler":        AdminProfile,
	"system_table_tools.GetChildTabConfigHandler":              LoginOnlyProfile, // Read by all users for reverse-FK/referring-tab rendering
	"system_table_tools.SaveChildTabConfigHandler":             AdminProfile,
	"system_table_tools.ListColumnViewPresetsHandler":          AdminProfile,
	"system_table_tools.SaveColumnViewPresetHandler":           AdminProfile,
	"system_table_tools.DeleteColumnViewPresetHandler":         AdminProfile,
	"system_table_tools.GetFilterbarSectionLayoutHandler":      AdminProfile,
	"system_table_tools.SaveFilterbarSectionLayoutHandler":     AdminProfile,
	"system_table_tools.GetTaskTodoProgressHandler":            LoginOnlyProfile,
	"router.GetDatasetAliasManagementHandler":                  AdminProfile,
	"router.SaveDatasetAliasManagementHandler":                 AdminProfile,

	// DB role management
	"db_admin.ListRolesHandler":  AdminProfile,
	"db_admin.CreateRoleHandler": AdminProfile,
	"db_admin.UpdateRoleHandler": AdminProfile,
	"db_admin.DeleteRoleHandler": AdminProfile,

	// Asset linking (schema-level operations)
	"dtt_asset_linking.EnableImageAssetLinkingHandler":    AdminProfile,
	"dtt_asset_linking.DisableImageAssetLinkingHandler":   AdminProfile,
	"dtt_asset_linking.RemoveImageAssetLinkingHandler":    AdminProfile,
	"dtt_asset_linking.GetImageAssetLinkingStatusHandler": AdminProfile,
	"dtt_asset_linking.GetAssetLinkingStatusHandler":      AdminProfile,
	"dtt_asset_linking.UpdateImageAssetLinkingHandler":    AdminProfile,
	"dtt_asset_linking.EnableAttachmentLinkingHandler":    AdminProfile,
	"dtt_asset_linking.DisableAttachmentLinkingHandler":   AdminProfile,
	"dtt_asset_linking.RemoveAttachmentLinkingHandler":    AdminProfile,
	"dtt_asset_linking.GetAttachmentLinkingStatusHandler": AdminProfile,

	// Schema modification
	"dtt_crud_workflows.ModifyColumnsHandler":     AdminProfile,
	"dtt_crud_workflows.CreateIndexesHandler":     AdminProfile,
	"dtt_crud_workflows.SetCommentsHandler":       AdminProfile,
	"dtt_crud_workflows.CreateTableHandler":       AdminProfile,
	"dtt_crud_workflows.SimpleCreateTableHandler": AdminProfile, // AI-powered table creation (ENABLE_API_LANGUAGE)
	"dtt_3_table_delete.DropTableHandler":         AdminProfile,
	"dtt_triggers.CreateTriggerHandler":           AdminProfile, // Trigger creation is a schema-level operation
	// devtools.CheckJsonInTextColumnsHandler — registered conditionally in init() below

	// Permission management
	"backend.SaveUserGroupRight": AdminProfile,
	"backend.PermissionsHandler": AdminProfile,

	// ── Default routes (explicit, authenticated + access-controlled) ──

	// Foreign key management
	"dtt_foreign_keys.AddForeignKeyHandler":    AdminProfile,
	"dtt_foreign_keys.DeleteForeignKeyHandler": AdminProfile,
	"dtt_foreign_keys.GetForeignKeys":          DefaultProfile,
	"dtt_foreign_keys.GetTableNamesHandler":    DefaultProfile,
	"router.GetDatasetAliasesHandler":          DefaultProfile,

	// AI / embedding features
	"ai_features.GetEmbeddingDatasetsHandler":  AdminProfile,
	"ai_features.EmbeddingStreamHandler":       AdminProfile,
	"event_bus.SSESubscribeHandler":            AccessControlNoTxProfile,
	"ai_features.RefreshLangEmbeddingsHandler": AdminProfile,
	"ai_features.CountLangEmbeddingsHandler":   AdminProfile,

	// System table tools
	"system_table_tools.GetGroupedTables":    DefaultProfile,
	"system_table_tools.GetEmptyRowsHandler": DefaultProfile,

	// Row create
	"dtt_1_row_create.AddRowMultipartHandlerWrapper":       DefaultProfile,
	"dtt_1_row_create.GeocodeAddressHandler":               DefaultProfile,
	"dtt_1_row_create.GetOneToManyRelationsHandlerWrapper": DefaultProfile,
	"dtt_1_row_create.GetAddRowMetadataHandlerWrapper":     DefaultProfile,
	"dtt_1_row_create.GetAddRowColumnsHandlerWrapper":      DefaultProfile,
	"dtt_1_row_create.GetManyToManyTablesHandlerWrapper":   DefaultProfile,
	"dtt_1_row_create.GetReferencedTableData":              DefaultProfile,

	// Row delete
	"dtt_1_row_delete.DeleteRowsHandlerWrapper": DefaultProfile,

	// Table read
	"dtt_3_table_read.GetTableViewHandlerWrapper": DefaultProfile,

	// Row read
	"dtt_1_row_read.GetDynamicChildItemsHandler":         DefaultProfile,
	"dtt_1_row_read.CommentListHandler":                  DefaultProfile,
	"dtt_1_row_read.CommentCreateHandler":                DefaultProfile,
	"dtt_1_row_read.CommentDeleteHandler":                DefaultProfile,
	"dtt_1_row_read.CommentCountHandler":                 DefaultProfile,
	"dtt_1_row_read.FilterbarAICapabilitiesHandler":      DefaultProfile,
	"dtt_1_row_read.FilterbarAIQueryHandler":             DefaultProfile,
	"dtt_1_row_read.GetIntelligentResultsHandlerWrapper": DefaultProfile,
	"dtt_1_row_read.GetFilterOptionsHandler":             DefaultProfile,
	"dtt_1_row_read.GetResultsHandlerWrapper":            DefaultProfile,
	"dtt_1_row_read.GetResultsVector":                    DefaultProfile,
	"dtt_1_row_read.GetRowCountHandlerWrapper":           DefaultProfile,

	// Row update
	"dtt_1_row_update.UpdateRowHandlerWrapper": DefaultProfile,

	// Column crud
	"dtt_2_column_crud.GetTableColumnsHandler": DefaultProfile,

	// Triggers (read)
	"dtt_triggers.GetTriggersHandler": DefaultProfile,

	// Table folders
	"dtt_system_table_folders.HandleUpdateFolder":            DefaultProfile,
	"dtt_system_table_folders.HandleUpdateTableFolder":       DefaultProfile,
	"dtt_system_table_folders.HandleSetCurrentProjectFolder": DefaultProfile,
	"dtt_system_table_folders.HandleCreateFolder":            DefaultProfile,
	"dtt_system_table_folders.HandleDeleteFolder":            DefaultProfile,
	"dtt_system_table_folders.HandleRenameTreeNode":          DefaultProfile,

	// Language / translation
	"lang.GenerateTranslationsHandler":   DefaultProfile,
	"lang.FixTableTranslationsHandler":   DefaultProfile,
	"lang.GetLangKeyTranslationsHandler": DefaultProfile,

	// Search vectors
	"dtt_search_vectors.TextIndexStatusHandler":     AdminProfile,
	"dtt_search_vectors.RebuildSearchVectorHandler": AdminProfile,

	// Vanilla tree
	"vanilla_tree.GetTreeDataHandler": DefaultProfile,
	"vanilla_tree.GetViewDataHandler": DefaultProfile,

	// AI language API routes (conditional: ENABLE_API_LANGUAGE)
	"dtt_crud_workflows.SimpleQueryTableHandler": AdminProfile,

	// Optional private apps register their own profiles from private activation packages.
}

var baseRouteProfiles = cloneRouteProfiles(RouteProfiles)

// RouteProfileDescriptor is a stable JSON-friendly projection of RouteProfile.
// It exists so generators can inspect effective pipeline rules without importing
// internal map semantics into their output format.
type RouteProfileDescriptor struct {
	ProfileName string   `json:"profile_name"`
	SkipStages  []string `json:"skip_stages"`
	AdminOnly   bool     `json:"admin_only"`
}

// ApplyDevOverrides modifies RouteProfiles for explicit development mode only.
// In dev mode, dev-only endpoints get their profiles registered and selected
// schema modification endpoints bypass access control for local iteration.
// Call this once at startup when ENVIRONMENT_TYPE=dev.
func ApplyDevOverrides() {
	envType := os.Getenv("ENVIRONMENT_TYPE")
	if envType != "dev" {
		return
	}

	RouteProfiles["devtools.QueenRunsHandler"] = AdminProfile
	RouteProfiles["devtools.QueenSessionsHandler"] = AdminProfile
	RouteProfiles["devtools.QueenSessionHandler"] = AdminProfile
	RouteProfiles["devtools.QueenSessionMessageHandler"] = AdminProfile
	RouteProfiles["devtools.QueenSessionStreamHandler"] = AdminProfile
	RouteProfiles["devtools.QueenSessionStopHandler"] = AdminProfile
	RouteProfiles["devtools.QueenTranscriptHandler"] = AdminProfile
	RouteProfiles["devtools.QueenTranscriptStreamHandler"] = AdminProfile

	// Dev tool profiles — only relevant when dev routes are registered
	devToolProfiles := map[string]RouteProfile{
		"devtools.SessionHandler":                AdminProfile,
		"devtools.ExportTableCSVHandler":         AdminProfile,
		"devtools.ImportTableCSVHandler":         AdminProfile,
		"pipeline.IntrospectionHandler":          AdminProfile,
		"devtools.LogClientError":                PublicProfile,
		"devtools.CheckJsonInTextColumnsHandler": AdminProfile,
		"lang.UpdateLangKeyHandler":              AdminProfile,
		"lang.AiTranslateSingleHandler":          AdminProfile,
	}
	for name, profile := range devToolProfiles {
		RouteProfiles[name] = profile
	}

	// Schema modification shortcuts for explicit local development convenience.
	devPublicHandlers := []string{
		"dtt_crud_workflows.CreateTableHandler",
		"dtt_crud_workflows.SetCommentsHandler",
		"dtt_crud_workflows.CreateIndexesHandler",
		"lang.GenerateTranslationsHandler",
	}
	for _, name := range devPublicHandlers {
		RouteProfiles[name] = PublicProfile
	}
}

// GetProfile returns the RouteProfile for a handler, falling back to DefaultProfile.
func GetProfile(handlerName string) RouteProfile {
	if p, ok := RouteProfiles[handlerName]; ok {
		return p
	}
	return DefaultProfile
}

// ResetRouteProfiles restores RouteProfiles to the checked-in baseline before
// dev overrides mutate it for the current environment.
func ResetRouteProfiles() {
	RouteProfiles = cloneRouteProfiles(baseRouteProfiles)
}

// RegisterRouteProfile adds a route profile from an optional/private package.
// Between: private app activation packages -> core pipeline profile lookup.
// Why: Filterest public builds can omit private app handler names from core code.
func RegisterRouteProfile(handlerName string, profile RouteProfile) {
	if handlerName == "" {
		panic("route profile handler name cannot be empty")
	}

	profileClone := cloneRouteProfile(profile)
	RouteProfiles[handlerName] = profileClone
	baseRouteProfiles[handlerName] = cloneRouteProfile(profileClone)
}

// DescribeRouteProfile returns a stable serializable view of the effective
// profile for one handler in the current environment.
func DescribeRouteProfile(handlerName string) RouteProfileDescriptor {
	profile := GetProfile(handlerName)
	return RouteProfileDescriptor{
		ProfileName: profileName(profile),
		SkipStages:  sortedSkipStages(profile),
		AdminOnly:   profile.AdminOnly,
	}
}

func cloneRouteProfiles(src map[string]RouteProfile) map[string]RouteProfile {
	clone := make(map[string]RouteProfile, len(src))
	for name, profile := range src {
		clone[name] = cloneRouteProfile(profile)
	}
	return clone
}

func cloneRouteProfile(profile RouteProfile) RouteProfile {
	skipStages := make(map[string]bool, len(profile.SkipStages))
	for stageName, enabled := range profile.SkipStages {
		skipStages[stageName] = enabled
	}
	return RouteProfile{
		SkipStages: skipStages,
		AdminOnly:  profile.AdminOnly,
	}
}

func sortedSkipStages(profile RouteProfile) []string {
	stageNames := make([]string, 0, len(profile.SkipStages))
	for stageName, shouldSkip := range profile.SkipStages {
		if shouldSkip {
			stageNames = append(stageNames, stageName)
		}
	}
	sort.Strings(stageNames)
	return stageNames
}

func profileName(profile RouteProfile) string {
	switch {
	case routeProfilesEqual(profile, PublicProfile):
		return "public"
	case routeProfilesEqual(profile, LoginOnlyProfile):
		return "login_only"
	case routeProfilesEqual(profile, AdminProfile):
		return "admin"
	case routeProfilesEqual(profile, AccessControlNoTxProfile):
		return "access_control_no_tx"
	case routeProfilesEqual(profile, DefaultProfile):
		return "default"
	default:
		return "custom"
	}
}

func routeProfilesEqual(left RouteProfile, right RouteProfile) bool {
	if left.AdminOnly != right.AdminOnly {
		return false
	}
	if len(left.SkipStages) != len(right.SkipStages) {
		return false
	}
	for stageName, shouldSkip := range left.SkipStages {
		if right.SkipStages[stageName] != shouldSkip {
			return false
		}
	}
	return true
}
