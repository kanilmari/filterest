// route_method_contracts.go
// Declares explicit HTTP method contracts for the stable backend route subset.
// Bridges runtime route registration and manifest/client generation without parsing handler bodies.
// Exists to publish trustworthy method metadata only where the contract is intentionally curated.
package router

import "net/http"

const RouteMethodSourceExplicitStableContract = "explicit_stable_contract"

// RouteMethodContract describes the declared HTTP method surface for one handler.
type RouteMethodContract struct {
	Methods []string
	Source  string
}

var explicitRouteMethodContracts = map[string]RouteMethodContract{
	// Stable auth bootstrap / permission cache routes.
	"router.healthHandler":                     {Methods: []string{http.MethodGet}, Source: RouteMethodSourceExplicitStableContract},
	"router.systemHealthHandler":               {Methods: []string{http.MethodGet}, Source: RouteMethodSourceExplicitStableContract},
	"router.systemReadyHandler":                {Methods: []string{http.MethodGet}, Source: RouteMethodSourceExplicitStableContract},
	"router.systemInstanceStatusHandler":       {Methods: []string{http.MethodGet}, Source: RouteMethodSourceExplicitStableContract},
	"router.systemDrainHandler":                {Methods: []string{http.MethodPost}, Source: RouteMethodSourceExplicitStableContract},
	"router.adminVersionInfoHandler":           {Methods: []string{http.MethodGet}, Source: RouteMethodSourceExplicitStableContract},
	"router.saveOpenAIAPIKeyHandler":           {Methods: []string{http.MethodPost}, Source: RouteMethodSourceExplicitStableContract},
	"router.GetDatasetAliasesHandler":          {Methods: []string{http.MethodGet}, Source: RouteMethodSourceExplicitStableContract},
	"router.GetDatasetAliasManagementHandler":  {Methods: []string{http.MethodGet}, Source: RouteMethodSourceExplicitStableContract},
	"router.SaveDatasetAliasManagementHandler": {Methods: []string{http.MethodPost}, Source: RouteMethodSourceExplicitStableContract},
	"auth.GetAuthModesHandler":                 {Methods: []string{http.MethodGet}, Source: RouteMethodSourceExplicitStableContract},
	"auth.FirstRunAdminHandler":                {Methods: []string{http.MethodGet, http.MethodPost}, Source: RouteMethodSourceExplicitStableContract},
	"product_identity.Handler":                 {Methods: []string{http.MethodGet}, Source: RouteMethodSourceExplicitStableContract},
	"auth.UserPermissionsHandler":              {Methods: []string{http.MethodGet}, Source: RouteMethodSourceExplicitStableContract},

	// Stable admin maintenance routes.
	"system_table_tools.ListFKCacheTriggersHandler":          {Methods: []string{http.MethodGet}, Source: RouteMethodSourceExplicitStableContract},
	"system_table_tools.RefreshFKCacheHandler":               {Methods: []string{http.MethodPost}, Source: RouteMethodSourceExplicitStableContract},
	"dtt_system_table_folders.HandleSetCurrentProjectFolder": {Methods: []string{http.MethodPost}, Source: RouteMethodSourceExplicitStableContract},
	"event_bus.SSESubscribeHandler":                          {Methods: []string{http.MethodGet}, Source: RouteMethodSourceExplicitStableContract},

	// Stable admin configuration routes that are next candidates for generated wrappers.
	"system_table_tools.GetCardVisibilityHandler":          {Methods: []string{http.MethodGet}, Source: RouteMethodSourceExplicitStableContract},
	"system_table_tools.UpdateCardVisibilityHandler":       {Methods: []string{http.MethodPost}, Source: RouteMethodSourceExplicitStableContract},
	"system_table_tools.GetDatasetHeaderConfigHandler":     {Methods: []string{http.MethodGet}, Source: RouteMethodSourceExplicitStableContract},
	"system_table_tools.SaveDatasetHeaderConfigHandler":    {Methods: []string{http.MethodPost}, Source: RouteMethodSourceExplicitStableContract},
	"system_table_tools.GetChildTabConfigHandler":          {Methods: []string{http.MethodGet}, Source: RouteMethodSourceExplicitStableContract},
	"system_table_tools.SaveChildTabConfigHandler":         {Methods: []string{http.MethodPost}, Source: RouteMethodSourceExplicitStableContract},
	"system_table_tools.ListColumnViewPresetsHandler":      {Methods: []string{http.MethodGet}, Source: RouteMethodSourceExplicitStableContract},
	"system_table_tools.SaveColumnViewPresetHandler":       {Methods: []string{http.MethodPost}, Source: RouteMethodSourceExplicitStableContract},
	"system_table_tools.DeleteColumnViewPresetHandler":     {Methods: []string{http.MethodPost}, Source: RouteMethodSourceExplicitStableContract},
	"system_table_tools.GetFilterbarSectionLayoutHandler":  {Methods: []string{http.MethodGet}, Source: RouteMethodSourceExplicitStableContract},
	"system_table_tools.SaveFilterbarSectionLayoutHandler": {Methods: []string{http.MethodPost}, Source: RouteMethodSourceExplicitStableContract},
	"system_table_tools.GetTaskTodoProgressHandler":        {Methods: []string{http.MethodGet}, Source: RouteMethodSourceExplicitStableContract},

	// Management-Easelect cloud view routes.
	"cloud_management.StatusHandler":            {Methods: []string{http.MethodGet}, Source: RouteMethodSourceExplicitStableContract},
	"cloud_management.InstancesStatusHandler":   {Methods: []string{http.MethodGet}, Source: RouteMethodSourceExplicitStableContract},
	"cloud_management.InstancesServicesHandler": {Methods: []string{http.MethodGet}, Source: RouteMethodSourceExplicitStableContract},
	"cloud_management.InstancesServiceHandler":  {Methods: []string{http.MethodGet}, Source: RouteMethodSourceExplicitStableContract},
	"cloud_management.InstancesNodeHandler":     {Methods: []string{http.MethodGet}, Source: RouteMethodSourceExplicitStableContract},
	"cloud_management.InstancesAuditHandler":    {Methods: []string{http.MethodGet}, Source: RouteMethodSourceExplicitStableContract},
	"cloud_management.InstancesActionPreflightHandler": {
		Methods: []string{http.MethodPost},
		Source:  RouteMethodSourceExplicitStableContract,
	},
	"cloud_management.InstancesActionHandler": {
		Methods: []string{http.MethodPost},
		Source:  RouteMethodSourceExplicitStableContract,
	},
	"cloud_management.InstancesRolloutPlanHandler": {
		Methods: []string{http.MethodPost},
		Source:  RouteMethodSourceExplicitStableContract,
	},
	"cloud_management.InstancesRolloutCreateHandler": {
		Methods: []string{http.MethodPost},
		Source:  RouteMethodSourceExplicitStableContract,
	},
	"cloud_management.InstancesRolloutHandler": {
		Methods: []string{http.MethodGet, http.MethodPost},
		Source:  RouteMethodSourceExplicitStableContract,
	},
	"cloud_management.ActionHandler": {Methods: []string{http.MethodPost}, Source: RouteMethodSourceExplicitStableContract},
	"cloud_management.LogsHandler":   {Methods: []string{http.MethodGet}, Source: RouteMethodSourceExplicitStableContract},
}

// GetRouteMethodContract returns the curated method contract for one handler when
// the route is part of the explicit stable subset.
func GetRouteMethodContract(handlerName string) (RouteMethodContract, bool) {
	contract, ok := explicitRouteMethodContracts[handlerName]
	if !ok {
		return RouteMethodContract{}, false
	}
	return RouteMethodContract{
		Methods: append([]string{}, contract.Methods...),
		Source:  contract.Source,
	}, true
}
