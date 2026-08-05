// route_manifest_builder_test.go
// Verifies runtime route manifest generation and reset-safe route registration.
// Bridges router registration, environment toggles, and manifest output expectations.
// Exists to prevent duplicate route accumulation and scenario coverage drift.
package router_test

import (
	"testing"

	"easelect/backend/core_components/router"
)

func TestRegisterRoutesResetsDefinitions(t *testing.T) {
	t.Setenv("ENVIRONMENT_TYPE", "production")
	t.Setenv("ENABLE_API_LANGUAGE", "")

	router.RegisterRoutes("frontend", "storage")
	productionRoutes := router.GetRouteDefinitions()
	if len(productionRoutes) == 0 {
		t.Fatal("expected production route registration to produce routes")
	}

	t.Setenv("ENVIRONMENT_TYPE", "dev")
	router.RegisterRoutes("frontend", "storage")
	developmentRoutes := router.GetRouteDefinitions()
	if len(developmentRoutes) == 0 {
		t.Fatal("expected development route registration to produce routes")
	}

	countByHandler := make(map[string]int, len(developmentRoutes))
	for _, route := range developmentRoutes {
		countByHandler[route.HandlerName]++
	}

	for handlerName, count := range countByHandler {
		if count != 1 {
			t.Fatalf("expected %s to be registered exactly once after a second RegisterRoutes call, got %d", handlerName, count)
		}
	}

	if countByHandler["devtools.SessionHandler"] != 1 {
		t.Fatalf("expected devtools.SessionHandler to be registered once in development, got %d", countByHandler["devtools.SessionHandler"])
	}
}

func TestRegisterRoutesDoesNotRegisterDevRoutesWhenEnvironmentUnset(t *testing.T) {
	t.Setenv("ENVIRONMENT_TYPE", "")
	t.Setenv("ENABLE_API_LANGUAGE", "")

	router.RegisterRoutes("frontend", "storage")
	routes := router.GetRouteDefinitions()
	if len(routes) == 0 {
		t.Fatal("expected route registration to produce routes")
	}

	for _, route := range routes {
		if route.HandlerName == "devtools.SessionHandler" {
			t.Fatal("did not expect devtools.SessionHandler to be registered when ENVIRONMENT_TYPE is unset")
		}
	}
}

func TestRegisterRoutesKeepsAPIFirstAIChatRoutesAndDropsLegacySSE(t *testing.T) {
	t.Setenv("ENVIRONMENT_TYPE", "production")
	t.Setenv("ENABLE_API_LANGUAGE", "")

	router.RegisterRoutes("frontend", "storage")
	routes := router.GetRouteDefinitions()
	if len(routes) == 0 {
		t.Fatal("expected route registration to produce routes")
	}

	handlerByPath := make(map[string]string, len(routes))
	for _, route := range routes {
		handlerByPath[route.UrlPattern] = route.HandlerName
	}

	if handlerByPath["/api/app/ai-chat/capabilities"] != "dtt_1_row_read.FilterbarAICapabilitiesHandler" {
		t.Fatalf("expected /api/app/ai-chat/capabilities to stay registered, got %q", handlerByPath["/api/app/ai-chat/capabilities"])
	}
	if handlerByPath["/api/app/ai-chat/query"] != "dtt_1_row_read.FilterbarAIQueryHandler" {
		t.Fatalf("expected /api/app/ai-chat/query to stay registered, got %q", handlerByPath["/api/app/ai-chat/query"])
	}
	if handlerByPath["/api/app/ai-chat/codex-query"] != "dtt_1_row_read.FilterbarAICodexQueryHandler" {
		t.Fatalf("expected /api/app/ai-chat/codex-query to stay registered, got %q", handlerByPath["/api/app/ai-chat/codex-query"])
	}
	if handlerByPath["/api/app/ai-chat/conversation"] != "dtt_1_row_read.FilterbarAIConversationHandler" {
		t.Fatalf("expected /api/app/ai-chat/conversation to stay registered, got %q", handlerByPath["/api/app/ai-chat/conversation"])
	}
	if _, exists := handlerByPath["/api/openai_chat_stream_handler"]; exists {
		t.Fatal("did not expect /api/openai_chat_stream_handler to remain registered")
	}
}

func TestBuildDefaultRouteManifestCoversScenarioMatrix(t *testing.T) {
	manifest, err := router.BuildDefaultRouteManifest()
	if err != nil {
		t.Fatalf("BuildDefaultRouteManifest returned error: %v", err)
	}
	if len(manifest.Routes) == 0 {
		t.Fatal("expected route manifest to contain routes")
	}

	loginAPI := mustFindManifestRoute(t, manifest, "auth.LoginAPIHandler")
	assertScenarioNames(t, loginAPI, []string{"production", "development", "api_language"})
	if loginAPI.MatchType != router.RouteMatchExact {
		t.Fatalf("expected auth.LoginAPIHandler to use exact match, got %s", loginAPI.MatchType)
	}
	assertRouteMethods(t, loginAPI, nil, "")
	if mustFindScenarioProfile(t, loginAPI, "production").ProfileName != "public" {
		t.Fatalf("expected auth.LoginAPIHandler production profile to be public")
	}

	passwordResetRequest := mustFindManifestRoute(t, manifest, "auth.RequestPasswordResetOTPHandler")
	assertScenarioNames(t, passwordResetRequest, []string{"production", "development", "api_language"})
	if mustFindScenarioProfile(t, passwordResetRequest, "production").ProfileName != "public" {
		t.Fatalf("expected auth.RequestPasswordResetOTPHandler production profile to be public")
	}

	passwordResetConfirm := mustFindManifestRoute(t, manifest, "auth.ResetPasswordWithOTPHandler")
	assertScenarioNames(t, passwordResetConfirm, []string{"production", "development", "api_language"})
	if mustFindScenarioProfile(t, passwordResetConfirm, "production").ProfileName != "public" {
		t.Fatalf("expected auth.ResetPasswordWithOTPHandler production profile to be public")
	}

	authModes := mustFindManifestRoute(t, manifest, "auth.GetAuthModesHandler")
	assertRouteMethods(t, authModes, []string{"GET"}, router.RouteMethodSourceExplicitStableContract)

	firstRunAdmin := mustFindManifestRoute(t, manifest, "auth.FirstRunAdminHandler")
	assertRouteMethods(t, firstRunAdmin, []string{"GET", "POST"}, router.RouteMethodSourceExplicitStableContract)
	if firstRunAdmin.PathPattern != "/first-run" {
		t.Fatalf("expected auth.FirstRunAdminHandler path to be /first-run, got %q", firstRunAdmin.PathPattern)
	}
	if mustFindScenarioProfile(t, firstRunAdmin, "production").ProfileName != "public" {
		t.Fatalf("expected auth.FirstRunAdminHandler production profile to be public")
	}

	health := mustFindManifestRoute(t, manifest, "router.healthHandler")
	assertScenarioNames(t, health, []string{"production", "development", "api_language"})
	assertRouteMethods(t, health, []string{"GET"}, router.RouteMethodSourceExplicitStableContract)
	if mustFindScenarioProfile(t, health, "production").ProfileName != "public" {
		t.Fatalf("expected router.healthHandler production profile to be public")
	}

	systemHealth := mustFindManifestRoute(t, manifest, "router.systemHealthHandler")
	assertScenarioNames(t, systemHealth, []string{"production", "development", "api_language"})
	assertRouteMethods(t, systemHealth, []string{"GET"}, router.RouteMethodSourceExplicitStableContract)
	if systemHealth.PathPattern != "/system/health" {
		t.Fatalf("expected router.systemHealthHandler path to be /system/health, got %q", systemHealth.PathPattern)
	}
	if mustFindScenarioProfile(t, systemHealth, "production").ProfileName != "public" {
		t.Fatalf("expected router.systemHealthHandler production profile to be public")
	}

	systemReady := mustFindManifestRoute(t, manifest, "router.systemReadyHandler")
	assertScenarioNames(t, systemReady, []string{"production", "development", "api_language"})
	assertRouteMethods(t, systemReady, []string{"GET"}, router.RouteMethodSourceExplicitStableContract)
	if systemReady.PathPattern != "/system/ready" {
		t.Fatalf("expected router.systemReadyHandler path to be /system/ready, got %q", systemReady.PathPattern)
	}
	if mustFindScenarioProfile(t, systemReady, "production").ProfileName != "public" {
		t.Fatalf("expected router.systemReadyHandler production profile to be public")
	}

	systemInstanceStatus := mustFindManifestRoute(t, manifest, "router.systemInstanceStatusHandler")
	assertScenarioNames(t, systemInstanceStatus, []string{"production", "development", "api_language"})
	assertRouteMethods(t, systemInstanceStatus, []string{"GET"}, router.RouteMethodSourceExplicitStableContract)
	if systemInstanceStatus.PathPattern != "/system/instance-status" {
		t.Fatalf("expected router.systemInstanceStatusHandler path to be /system/instance-status, got %q", systemInstanceStatus.PathPattern)
	}
	if mustFindScenarioProfile(t, systemInstanceStatus, "production").ProfileName != "public" {
		t.Fatalf("expected router.systemInstanceStatusHandler production profile to be public")
	}

	systemDrain := mustFindManifestRoute(t, manifest, "router.systemDrainHandler")
	assertScenarioNames(t, systemDrain, []string{"production", "development", "api_language"})
	assertRouteMethods(t, systemDrain, []string{"POST"}, router.RouteMethodSourceExplicitStableContract)
	if systemDrain.PathPattern != "/system/drain" {
		t.Fatalf("expected router.systemDrainHandler path to be /system/drain, got %q", systemDrain.PathPattern)
	}
	if mustFindScenarioProfile(t, systemDrain, "production").ProfileName != "public" {
		t.Fatalf("expected router.systemDrainHandler production profile to be public")
	}

	adminVersionInfo := mustFindManifestRoute(t, manifest, "router.adminVersionInfoHandler")
	assertScenarioNames(t, adminVersionInfo, []string{"production", "development", "api_language"})
	assertRouteMethods(t, adminVersionInfo, []string{"GET"}, router.RouteMethodSourceExplicitStableContract)
	if adminVersionInfo.PathPattern != "/api/admin/version-info" {
		t.Fatalf("expected router.adminVersionInfoHandler path to be /api/admin/version-info, got %q", adminVersionInfo.PathPattern)
	}
	if mustFindScenarioProfile(t, adminVersionInfo, "production").ProfileName != "admin" {
		t.Fatalf("expected router.adminVersionInfoHandler production profile to be admin")
	}

	openAIKeySave := mustFindManifestRoute(t, manifest, "router.saveOpenAIAPIKeyHandler")
	assertScenarioNames(t, openAIKeySave, []string{"production", "development", "api_language"})
	assertRouteMethods(t, openAIKeySave, []string{"POST"}, router.RouteMethodSourceExplicitStableContract)
	if openAIKeySave.PathPattern != "/api/admin/openai-api-key" {
		t.Fatalf("expected router.saveOpenAIAPIKeyHandler path to be /api/admin/openai-api-key, got %q", openAIKeySave.PathPattern)
	}
	if mustFindScenarioProfile(t, openAIKeySave, "production").ProfileName != "admin" {
		t.Fatalf("expected router.saveOpenAIAPIKeyHandler production profile to be admin")
	}

	userPermissions := mustFindManifestRoute(t, manifest, "auth.UserPermissionsHandler")
	assertRouteMethods(t, userPermissions, []string{"GET"}, router.RouteMethodSourceExplicitStableContract)

	createDataset := mustFindManifestRoute(t, manifest, "dtt_crud_workflows.CreateTableHandler")
	assertScenarioNames(t, createDataset, []string{"production", "development", "api_language"})
	assertRouteMethods(t, createDataset, nil, "")
	if mustFindScenarioProfile(t, createDataset, "production").ProfileName != "admin" {
		t.Fatalf("expected CreateTableHandler production profile to be admin")
	}
	if mustFindScenarioProfile(t, createDataset, "development").ProfileName != "public" {
		t.Fatalf("expected CreateTableHandler development profile to be public")
	}

	queenRuns := mustFindManifestRoute(t, manifest, "devtools.QueenRunsHandler")
	assertScenarioNames(t, queenRuns, []string{"development"})
	if queenRuns.ConditionalSource != "ENVIRONMENT_TYPE='dev'" {
		t.Fatalf("expected devtools.QueenRunsHandler conditional source to describe dev-only registration, got %q", queenRuns.ConditionalSource)
	}
	if mustFindScenarioProfile(t, queenRuns, "development").ProfileName != "admin" {
		t.Fatalf("expected devtools.QueenRunsHandler development profile to be admin")
	}

	simpleCreateTable := mustFindManifestRoute(t, manifest, "dtt_crud_workflows.SimpleCreateTableHandler")
	assertScenarioNames(t, simpleCreateTable, []string{"api_language"})
	if simpleCreateTable.ConditionalSource != "ENABLE_API_LANGUAGE=true" {
		t.Fatalf("expected SimpleCreateTableHandler conditional source to describe API language gating, got %q", simpleCreateTable.ConditionalSource)
	}
	if mustFindScenarioProfile(t, simpleCreateTable, "api_language").ProfileName != "admin" {
		t.Fatalf("expected SimpleCreateTableHandler api_language profile to be admin")
	}

	fkCacheTriggers := mustFindManifestRoute(t, manifest, "system_table_tools.ListFKCacheTriggersHandler")
	assertRouteMethods(t, fkCacheTriggers, []string{"GET"}, router.RouteMethodSourceExplicitStableContract)

	sseSubscribe := mustFindManifestRoute(t, manifest, "event_bus.SSESubscribeHandler")
	assertScenarioNames(t, sseSubscribe, []string{"production", "development", "api_language"})
	assertRouteMethods(t, sseSubscribe, []string{"GET"}, router.RouteMethodSourceExplicitStableContract)
	if mustFindScenarioProfile(t, sseSubscribe, "production").ProfileName != "access_control_no_tx" {
		t.Fatalf("expected event_bus.SSESubscribeHandler production profile to be access_control_no_tx")
	}

	datasetAliases := mustFindManifestRoute(t, manifest, "router.GetDatasetAliasesHandler")
	assertScenarioNames(t, datasetAliases, []string{"production", "development", "api_language"})
	assertRouteMethods(t, datasetAliases, []string{"GET"}, router.RouteMethodSourceExplicitStableContract)
	if mustFindScenarioProfile(t, datasetAliases, "production").ProfileName != "default" {
		t.Fatalf("expected router.GetDatasetAliasesHandler production profile to be default")
	}

	datasetAliasManagementGet := mustFindManifestRoute(t, manifest, "router.GetDatasetAliasManagementHandler")
	assertScenarioNames(t, datasetAliasManagementGet, []string{"production", "development", "api_language"})
	assertRouteMethods(t, datasetAliasManagementGet, []string{"GET"}, router.RouteMethodSourceExplicitStableContract)
	if mustFindScenarioProfile(t, datasetAliasManagementGet, "production").ProfileName != "admin" {
		t.Fatalf("expected router.GetDatasetAliasManagementHandler production profile to be admin")
	}

	datasetAliasManagementSave := mustFindManifestRoute(t, manifest, "router.SaveDatasetAliasManagementHandler")
	assertScenarioNames(t, datasetAliasManagementSave, []string{"production", "development", "api_language"})
	assertRouteMethods(t, datasetAliasManagementSave, []string{"POST"}, router.RouteMethodSourceExplicitStableContract)
	if mustFindScenarioProfile(t, datasetAliasManagementSave, "production").ProfileName != "admin" {
		t.Fatalf("expected router.SaveDatasetAliasManagementHandler production profile to be admin")
	}

	fkCacheRefresh := mustFindManifestRoute(t, manifest, "system_table_tools.RefreshFKCacheHandler")
	assertRouteMethods(t, fkCacheRefresh, []string{"POST"}, router.RouteMethodSourceExplicitStableContract)

	datasetHeaderGet := mustFindManifestRoute(t, manifest, "system_table_tools.GetDatasetHeaderConfigHandler")
	assertRouteMethods(t, datasetHeaderGet, []string{"GET"}, router.RouteMethodSourceExplicitStableContract)

	datasetHeaderSave := mustFindManifestRoute(t, manifest, "system_table_tools.SaveDatasetHeaderConfigHandler")
	assertRouteMethods(t, datasetHeaderSave, []string{"POST"}, router.RouteMethodSourceExplicitStableContract)

	columnPresetList := mustFindManifestRoute(t, manifest, "system_table_tools.ListColumnViewPresetsHandler")
	assertRouteMethods(t, columnPresetList, []string{"GET"}, router.RouteMethodSourceExplicitStableContract)

	columnPresetDelete := mustFindManifestRoute(t, manifest, "system_table_tools.DeleteColumnViewPresetHandler")
	assertRouteMethods(t, columnPresetDelete, []string{"POST"}, router.RouteMethodSourceExplicitStableContract)

	setCurrentProject := mustFindManifestRoute(t, manifest, "dtt_system_table_folders.HandleSetCurrentProjectFolder")
	assertScenarioNames(t, setCurrentProject, []string{"production", "development", "api_language"})
	assertRouteMethods(t, setCurrentProject, []string{"POST"}, router.RouteMethodSourceExplicitStableContract)

	rootHandler := mustFindManifestRoute(t, manifest, "router.rootHandler")
	if rootHandler.MatchType != router.RouteMatchPrefix {
		t.Fatalf("expected router.rootHandler to use prefix matching, got %s", rootHandler.MatchType)
	}
	assertRouteMethods(t, rootHandler, nil, "")

	paymentStatus := mustFindManifestRoute(t, manifest, "payment_gateway.GetPaymentStatusHandler")
	if paymentStatus.MatchType != router.RouteMatchPrefix {
		t.Fatalf("expected payment status route to use prefix matching, got %s", paymentStatus.MatchType)
	}
	assertRouteMethods(t, paymentStatus, nil, "")
}

func TestBuildDefaultRouteManifestMarksSensitiveRoutesAdmin(t *testing.T) {
	manifest, err := router.BuildDefaultRouteManifest()
	if err != nil {
		t.Fatalf("BuildDefaultRouteManifest returned error: %v", err)
	}

	testCases := []struct {
		handlerName string
		scenarios   []string
	}{
		{handlerName: "ai_features.GetEmbeddingDatasetsHandler", scenarios: []string{"production", "development", "api_language"}},
		{handlerName: "ai_features.EmbeddingStreamHandler", scenarios: []string{"production", "development", "api_language"}},
		{handlerName: "ai_features.RefreshLangEmbeddingsHandler", scenarios: []string{"production", "development", "api_language"}},
		{handlerName: "ai_features.CountLangEmbeddingsHandler", scenarios: []string{"production", "development", "api_language"}},
		{handlerName: "dtt_search_vectors.TextIndexStatusHandler", scenarios: []string{"production", "development", "api_language"}},
		{handlerName: "dtt_search_vectors.RebuildSearchVectorHandler", scenarios: []string{"production", "development", "api_language"}},
		{handlerName: "dtt_foreign_keys.AddForeignKeyHandler", scenarios: []string{"production", "development", "api_language"}},
		{handlerName: "dtt_foreign_keys.DeleteForeignKeyHandler", scenarios: []string{"production", "development", "api_language"}},
		{handlerName: "dtt_crud_workflows.SimpleQueryTableHandler", scenarios: []string{"api_language"}},
	}

	for _, testCase := range testCases {
		t.Run(testCase.handlerName, func(t *testing.T) {
			route := mustFindManifestRoute(t, manifest, testCase.handlerName)
			assertScenarioNames(t, route, testCase.scenarios)
			for _, scenarioName := range testCase.scenarios {
				profile := mustFindScenarioProfile(t, route, scenarioName)
				if profile.ProfileName != "admin" {
					t.Fatalf("%s profile = %q, want admin", scenarioName, profile.ProfileName)
				}
				if !profile.AdminOnly {
					t.Fatalf("%s AdminOnly = false, want true", scenarioName)
				}
			}
		})
	}
}

func mustFindManifestRoute(t *testing.T, manifest router.RouteManifest, handlerName string) router.RouteManifestEntry {
	t.Helper()
	for _, route := range manifest.Routes {
		if route.HandlerName == handlerName {
			return route
		}
	}
	t.Fatalf("could not find manifest route for handler %s", handlerName)
	return router.RouteManifestEntry{}
}

func mustFindScenarioProfile(t *testing.T, route router.RouteManifestEntry, scenarioName string) router.RouteManifestScenarioProfile {
	t.Helper()
	for _, scenario := range route.Scenarios {
		if scenario.Name == scenarioName {
			return scenario
		}
	}
	t.Fatalf("could not find scenario %s for handler %s", scenarioName, route.HandlerName)
	return router.RouteManifestScenarioProfile{}
}

func assertScenarioNames(t *testing.T, route router.RouteManifestEntry, want []string) {
	t.Helper()
	if len(route.Scenarios) != len(want) {
		t.Fatalf("expected %d scenarios for %s, got %d", len(want), route.HandlerName, len(route.Scenarios))
	}
	for index, scenario := range route.Scenarios {
		if scenario.Name != want[index] {
			t.Fatalf("expected scenario %d for %s to be %s, got %s", index, route.HandlerName, want[index], scenario.Name)
		}
	}
}

func assertRouteMethods(t *testing.T, route router.RouteManifestEntry, want []string, wantSource string) {
	t.Helper()
	if len(route.Methods) != len(want) {
		t.Fatalf("expected %d methods for %s, got %d", len(want), route.HandlerName, len(route.Methods))
	}
	for index, method := range want {
		if route.Methods[index] != method {
			t.Fatalf("expected method %d for %s to be %s, got %s", index, route.HandlerName, method, route.Methods[index])
		}
	}
	if route.MethodSource != wantSource {
		t.Fatalf("expected method source for %s to be %q, got %q", route.HandlerName, wantSource, route.MethodSource)
	}
}
