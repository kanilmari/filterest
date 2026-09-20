// route_method_contracts.go
// Owns the shared HTTP-method contract attached to every backend route registration.
// Bridges route declarations, runtime enforcement, and manifest/client generation.
// Exists so one machine-readable declaration controls which methods reach each handler.
package router

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"easelect/backend/core_components/httpresponse"
)

const RouteMethodSourceRegistration = "route_registration"

// RouteMethodSourceExplicitStableContract is retained as a source-compatible
// name for downstream tests while route registration replaces the old map.
const RouteMethodSourceExplicitStableContract = RouteMethodSourceRegistration

// RouteMethodContract describes the declared HTTP method surface for one handler.
type RouteMethodContract struct {
	Methods []string
	Source  string
}

type methodNotAllowedResponseKind int

const (
	methodNotAllowedStandardJSON methodNotAllowedResponseKind = iota
	methodNotAllowedPlainText
	methodNotAllowedSimpleJSON
	methodNotAllowedNestedJSON
)

type methodNotAllowedResponse struct {
	Kind    methodNotAllowedResponseKind
	Message string
	NoStore bool
}

// legacyMethodNotAllowedResponses preserves route-visible rejection bodies
// while their duplicated handler guards move into the shared route boundary.
var legacyMethodNotAllowedResponses = map[string]methodNotAllowedResponse{
	"agent_tools.HandoverReportsHandler":                       {Message: "method_not_allowed"},
	"agent_tools.TaskGroupsHandler":                            {Kind: methodNotAllowedPlainText, Message: "Method not allowed"},
	"agent_tools.TaskRunsHandler":                              {Kind: methodNotAllowedPlainText, Message: "Method not allowed"},
	"agent_tools.TaskTodosHandler":                             {Kind: methodNotAllowedPlainText, Message: "Method not allowed"},
	"agent_tools.TasksHandler":                                 {Kind: methodNotAllowedPlainText, Message: "Method not allowed"},
	"agent_tools.WorklineReportsHandler":                       {Message: "method_not_allowed"},
	"agent_tools.WorklineTasksHandler":                         {Message: "method_not_allowed"},
	"agent_tools.WorklinesHandler":                             {Message: "method_not_allowed"},
	"ai_features.CountLangEmbeddingsHandler":                   {Message: "only POST allowed"},
	"ai_features.EmbeddingStreamHandler":                       {Message: "only GET method allowed for SSE", NoStore: true},
	"ai_features.ExternalEmbeddingSourcePolicyHandler":         {Message: "only GET and POST allowed"},
	"ai_features.GetEmbeddingDatasetsHandler":                  {Message: "only GET allowed"},
	"ai_features.RefreshLangEmbeddingsHandler":                 {Message: "only POST allowed"},
	"auth.AdminUserAuthenticationHandler":                      {Message: "method_not_allowed"},
	"auth.CSRFTokenHandler":                                    {Message: "Method not allowed"},
	"auth.CheckTableRightsHandler":                             {Message: "only POST method is allowed"},
	"auth.CheckTableRightsMultiHandler":                        {Message: "only POST method is allowed"},
	"auth.FirstRunAdminHandler":                                {Message: "Method not allowed"},
	"auth.GetAuthModesHandler":                                 {Message: "Method not allowed"},
	"auth.LoginAPIHandler":                                     {Message: "Method not allowed"},
	"auth.LoginHandler":                                        {Message: "Method not allowed"},
	"auth.RegisterAPIHandler":                                  {Message: "Method not allowed"},
	"auth.RegisterHandler":                                     {Message: "Method not allowed"},
	"auth.RequestEmailChangeOTPHandler":                        {Message: "Method not allowed"},
	"auth.RequestPasswordChangeOTPHandler":                     {Message: "Method not allowed"},
	"auth.RequestPasswordResetOTPHandler":                      {Message: "Method not allowed"},
	"auth.ResetPasswordWithOTPHandler":                         {Message: "Method not allowed"},
	"auth.SiteAssistantDelegationExchangeHandler":              {Kind: methodNotAllowedSimpleJSON, Message: "method_not_allowed", NoStore: true},
	"auth.UserProfileFetchHandler":                             {Message: "Method not allowed"},
	"auth.UserProfileUpdateHandler":                            {Message: "Method not allowed"},
	"backend.SaveUserGroupRight":                               {Message: "Vain POST-pyynnöt sallitaan"},
	"db_admin.CreateRoleHandler":                               {Kind: methodNotAllowedSimpleJSON},
	"db_admin.DeleteRoleHandler":                               {Kind: methodNotAllowedSimpleJSON},
	"db_admin.ListRolesHandler":                                {Kind: methodNotAllowedSimpleJSON},
	"db_admin.UpdateRoleHandler":                               {Kind: methodNotAllowedSimpleJSON},
	"devtools.LogClientError":                                  {Message: "Method not allowed"},
	"dtt_1_row_create.AddRowMultipartHandlerWrapper":           {Message: "only POST requests are allowed"},
	"dtt_1_row_create.GeocodeAddressHandler":                   {Message: "Only POST allowed"},
	"dtt_1_row_create.GetAddRowMetadataHandlerWrapper":         {Message: "only GET requests are allowed"},
	"dtt_1_row_read.ChatAttachmentHandler":                     {Message: "only POST accepted", NoStore: true},
	"dtt_1_row_read.FilterbarAICapabilitiesHandler":            {Message: "only GET accepted"},
	"dtt_1_row_read.FilterbarAICodexQueryHandler":              {Message: "only POST accepted"},
	"dtt_1_row_read.FilterbarAIConversationHandler":            {Message: "only GET and PUT accepted"},
	"dtt_1_row_read.FilterbarAIQueryHandler":                   {Message: "only POST accepted"},
	"dtt_1_row_read.GetIntelligentResultsHandlerWrapper":       {Message: "only GET accepted"},
	"dtt_1_row_read.SiteAssistantApprovalHandler":              {Message: "only POST accepted", NoStore: true},
	"dtt_1_row_update.UpdateRowHandlerWrapper":                 {Message: "Only POST requests are allowed"},
	"dtt_3_table_delete.DropTableHandler":                      {Message: "only POST allowed"},
	"dtt_asset_linking.DisableAttachmentLinkingHandler":        {Message: "only POST method is allowed"},
	"dtt_asset_linking.DisableImageAssetLinkingHandler":        {Message: "only POST method is allowed"},
	"dtt_asset_linking.EnableAttachmentLinkingHandler":         {Message: "only POST method is allowed"},
	"dtt_asset_linking.EnableImageAssetLinkingHandler":         {Message: "only POST method is allowed"},
	"dtt_asset_linking.GetAssetLinkingStatusHandler":           {Message: "only GET method is allowed"},
	"dtt_asset_linking.GetAttachmentLinkingStatusHandler":      {Message: "only GET method is allowed"},
	"dtt_asset_linking.GetImageAssetLinkingStatusHandler":      {Message: "only GET method is allowed"},
	"dtt_asset_linking.RemoveAttachmentLinkingHandler":         {Message: "only POST method is allowed"},
	"dtt_asset_linking.RemoveImageAssetLinkingHandler":         {Message: "only POST method is allowed"},
	"dtt_asset_linking.UpdateImageAssetLinkingHandler":         {Message: "only POST method is allowed"},
	"dtt_crud_workflows.CreateIndexesHandler":                  {Message: "Method not allowed"},
	"dtt_crud_workflows.CreateTableHandler":                    {Message: "only POST method is allowed"},
	"dtt_crud_workflows.ModifyColumnsHandler":                  {Message: "only GET and POST allowed"},
	"dtt_crud_workflows.SetCommentsHandler":                    {Message: "Method not allowed"},
	"dtt_crud_workflows.SimpleCreateTableHandler":              {Message: "only POST method is allowed"},
	"dtt_crud_workflows.SimpleQueryTableHandler":               {Message: "only POST method is allowed"},
	"dtt_foreign_keys.AddForeignKeyHandler":                    {Message: "Method not allowed"},
	"dtt_foreign_keys.DeleteForeignKeyHandler":                 {Message: "Metodi ei ole sallittu"},
	"dtt_search_vectors.RebuildSearchVectorHandler":            {Message: "only POST allowed"},
	"dtt_search_vectors.TextIndexStatusHandler":                {Message: "only GET allowed"},
	"e_sessions.ResetSessionHandler":                           {Message: "unsupported method, only POST allowed"},
	"event_bus.SSESubscribeHandler":                            {Kind: methodNotAllowedPlainText, NoStore: true},
	"image_source_picker.FileHandler":                          {Kind: methodNotAllowedNestedJSON, Message: "Method not allowed.", NoStore: true},
	"image_source_picker.ProvidersHandler":                     {Kind: methodNotAllowedNestedJSON, Message: "Method not allowed.", NoStore: true},
	"image_source_picker.ResolveHandler":                       {Kind: methodNotAllowedNestedJSON, Message: "Method not allowed.", NoStore: true},
	"lang.AiTranslateSingleHandler":                            {Message: "POST only"},
	"payment_gateway.CreatePaymentHandler":                     {Message: "Method not allowed"},
	"payment_gateway.GetPaymentStatusHandler":                  {Message: "Method not allowed"},
	"payment_gateway.WebhookHandler":                           {Message: "Method not allowed"},
	"product_identity.Handler":                                 {Kind: methodNotAllowedPlainText},
	"router.adminUpdateNoticeStreamHandler":                    {Message: "Method not allowed", NoStore: true},
	"router.adminVersionInfoHandler":                           {Message: "Method not allowed"},
	"router.healthHandler":                                     {Message: "Method not allowed"},
	"router.saveOpenAIAPIKeyHandler":                           {Message: "only POST accepted"},
	"router.siteAssistantAPICatalogHandler":                    {Message: "Method not allowed"},
	"router.systemAutomationAccountHandler":                    {Message: "method_not_allowed", NoStore: true},
	"router.systemDrainHandler":                                {Message: "Method not allowed"},
	"router.systemHealthHandler":                               {Message: "Method not allowed"},
	"router.systemInstanceStatusHandler":                       {Message: "Method not allowed"},
	"router.systemReadyHandler":                                {Message: "Method not allowed"},
	"router.systemUpdateNoticeHandler":                         {Message: "Method not allowed", NoStore: true},
	"symbol_registry.AssetHandler":                             {NoStore: true},
	"system_table_tools.AdminDatasetUIVisibilityHandler":       {NoStore: true},
	"system_table_tools.ArchiveMediaTableFoldersHandler":       {Message: "only POST allowed"},
	"system_table_tools.CheckDatabaseConsistencyHandler":       {Message: "only GET allowed"},
	"system_table_tools.CheckMediaSubfoldersHandler":           {Message: "only GET allowed"},
	"system_table_tools.FixDatabaseConsistencyHandler":         {Message: "only POST allowed"},
	"system_table_tools.FixMediaSubfoldersHandler":             {Message: "only POST allowed"},
	"system_table_tools.GetAboutRowHandler":                    {Message: "Method not allowed"},
	"system_table_tools.ListFKCacheTriggersHandler":            {Message: "only GET allowed"},
	"system_table_tools.PreviewDataRetentionHandler":           {Message: "only GET allowed"},
	"system_table_tools.PreviewLogRetentionHandler":            {Message: "only GET allowed"},
	"system_table_tools.PruneArchivedMediaTableFoldersHandler": {Message: "only POST allowed"},
	"system_table_tools.PruneDataRetentionHandler":             {Message: "only POST allowed"},
	"system_table_tools.PruneLogRetentionHandler":              {Message: "only POST allowed"},
	"system_table_tools.RefreshFKCacheHandler":                 {Message: "only POST allowed"},
	"system_table_tools.ScanLangSourcesHandler":                {Message: "only POST allowed"},
	"workline_observatory.BoardHandler":                        {Message: "method_not_allowed"},
	"workline_observatory.ReleaseContractsHandler":             {Message: "method_not_allowed"},
	"workline_observatory.ReleaseGoalsHandler":                 {Message: "method_not_allowed"},
	"workline_observatory.WorklinePriorityActionsHandler":      {Message: "method_not_allowed"},
	"workline_observatory.WorklineStatusActionsHandler":        {Message: "method_not_allowed"},
}

// newRouteMethodContract normalizes one registration's methods. HEAD follows
// GET because every ordinary read route must answer metadata-only requests too.
func newRouteMethodContract(methods ...string) RouteMethodContract {
	normalized := make([]string, 0, len(methods)+1)
	seen := make(map[string]bool, len(methods)+1)
	for _, method := range methods {
		method = strings.ToUpper(strings.TrimSpace(method))
		if method == "" || seen[method] {
			continue
		}
		seen[method] = true
		normalized = append(normalized, method)
		if method == http.MethodGet && !seen[http.MethodHead] {
			seen[http.MethodHead] = true
			normalized = append(normalized, http.MethodHead)
		}
	}
	if len(normalized) == 0 {
		return RouteMethodContract{}
	}
	return RouteMethodContract{Methods: normalized, Source: RouteMethodSourceRegistration}
}

// enforceRouteMethods prevents a request from entering its handler unless the
// route registration declares that method. Empty contracts remain a temporary
// compatibility path for optional downstream routes using the old registrar.
func enforceRouteMethods(next http.HandlerFunc, handlerName string, contract RouteMethodContract) http.HandlerFunc {
	allowed := make(map[string]bool, len(contract.Methods))
	for _, method := range contract.Methods {
		allowed[method] = true
	}
	return func(w http.ResponseWriter, r *http.Request) {
		if len(allowed) == 0 || allowed[r.Method] {
			if r.Method == http.MethodHead && allowed[http.MethodGet] {
				getRequest := new(http.Request)
				*getRequest = *r
				getRequest.Method = http.MethodGet
				next(w, getRequest)
				return
			}
			next(w, r)
			return
		}
		w.Header().Set("Allow", strings.Join(contract.Methods, ", "))
		writeMethodNotAllowed(w, handlerName)
	}
}

func writeMethodNotAllowed(w http.ResponseWriter, handlerName string) {
	response := legacyMethodNotAllowedResponses[handlerName]
	if response.Message == "" {
		response.Message = "method not allowed"
	}
	if response.NoStore {
		w.Header().Set("Cache-Control", "no-store")
	}
	switch response.Kind {
	case methodNotAllowedPlainText:
		http.Error(w, response.Message, http.StatusMethodNotAllowed)
	case methodNotAllowedSimpleJSON:
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusMethodNotAllowed)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": response.Message})
	case methodNotAllowedNestedJSON:
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusMethodNotAllowed)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"error": map[string]string{"code": "method_not_allowed", "message": response.Message},
		})
	default:
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, response.Message)
	}
}

// validateRouteMethodContract gives registration and manifest tests one exact
// failure message for a missing method declaration.
func validateRouteMethodContract(route RouteDefinition) error {
	if len(route.Methods) == 0 {
		return fmt.Errorf("route %s (%s) has no declared methods", route.UrlPattern, route.HandlerName)
	}
	return nil
}

// GetRouteMethodContract reads the live route registry. New code should use
// RouteDefinition directly because the same handler can serve several paths.
func GetRouteMethodContract(handlerName string) (RouteMethodContract, bool) {
	for _, route := range routeDefinitions {
		if route.HandlerName == handlerName && len(route.Methods) > 0 {
			return RouteMethodContract{
				Methods: append([]string(nil), route.Methods...),
				Source:  route.MethodSource,
			}, true
		}
	}
	return RouteMethodContract{}, false
}
