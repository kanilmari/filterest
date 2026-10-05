// retired_reference_route_test.go
// Verifies the unrestricted reference-list route is retired in every runtime mode.
// Bridges actual route registration, generated manifest input and security profiles.
// Exists to prevent restoring the old endpoint while inline editors use policy-aware reads.
package router_test

import (
	"testing"

	"easelect/backend/core_components/router"
	"easelect/backend/pipeline"
)

func TestReferencedDataRouteIsRetired(t *testing.T) {
	for _, scenario := range []struct{ name, environment, apiLanguage string }{
		{"production", "production", ""},
		{"development", "dev", ""},
		{"api_language", "production", "true"},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			t.Setenv("ENVIRONMENT_TYPE", scenario.environment)
			t.Setenv("ENABLE_API_LANGUAGE", scenario.apiLanguage)
			router.RegisterRoutes("frontend", "storage")
			foundOptions := false
			for _, route := range router.GetRouteDefinitions() {
				if route.UrlPattern == "/api/referenced-data" || route.HandlerName == "dtt_1_row_create.GetReferencedTableData" {
					t.Fatalf("retired reference route is registered: %+v", route)
				}
				if route.UrlPattern == "/api/get-filter-options" {
					foundOptions = true
				}
			}
			if !foundOptions {
				t.Fatal("policy-aware option route is missing")
			}
		})
	}
	if _, exists := pipeline.RouteProfiles["dtt_1_row_create.GetReferencedTableData"]; exists {
		t.Fatal("retired handler retains a route profile")
	}
}
