// admin_ui_feature_flags_contract_test.go
// Verifies the admin UI flag route stays exact, GET-only, and admin-profiled.
// Bridges runtime registration, pipeline metadata, and the generated route manifest.
// Exists so an internal testing flag cannot become anonymously readable.
package router_test

import (
	"net/http"
	"testing"

	"easelect/backend/core_components/router"
)

func TestAdminUIFeatureFlagsRouteContract(t *testing.T) {
	t.Setenv("ENVIRONMENT_TYPE", "production")
	t.Setenv("ENABLE_API_LANGUAGE", "")
	router.RegisterRoutes("frontend", "storage")

	const handlerName = "system_table_tools.GetAdminUIFeatureFlagsHandler"
	for _, route := range router.GetRouteDefinitions() {
		if route.HandlerName != handlerName {
			continue
		}
		if route.UrlPattern != "/api/admin/ui-feature-flags" {
			t.Fatalf("path = %q", route.UrlPattern)
		}
		if route.MatchType != router.RouteMatchExact {
			t.Fatalf("match type = %q, want exact", route.MatchType)
		}

		contract, ok := router.GetRouteMethodContract(handlerName)
		if !ok {
			t.Fatal("method contract is missing")
		}
		if len(contract.Methods) != 2 || contract.Methods[0] != http.MethodGet || contract.Methods[1] != http.MethodHead {
			t.Fatalf("methods = %#v, want GET and HEAD", contract.Methods)
		}

		manifest, err := router.BuildDefaultRouteManifest()
		if err != nil {
			t.Fatalf("BuildDefaultRouteManifest: %v", err)
		}
		for _, manifestRoute := range manifest.Routes {
			if manifestRoute.HandlerName != handlerName {
				continue
			}
			if len(manifestRoute.Methods) != 2 || manifestRoute.Methods[0] != http.MethodGet || manifestRoute.Methods[1] != http.MethodHead {
				t.Fatalf("manifest methods = %#v, want GET and HEAD", manifestRoute.Methods)
			}
			for _, scenario := range manifestRoute.Scenarios {
				if scenario.ProfileName != "admin" {
					t.Fatalf("scenario %q profile = %q, want admin", scenario.Name, scenario.ProfileName)
				}
			}
			return
		}
		t.Fatal("admin UI feature flags route is missing from manifest")
	}
	t.Fatal("admin UI feature flags route is not registered")
}
