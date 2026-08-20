// admin_lang_key_contract_test.go
// Verifies the production language-key route stays exact, POST-only, and admin-profiled.
// Bridges runtime registration, pipeline metadata, and generated route-manifest semantics.
// Exists so production translation maintenance cannot lose its security boundary.
package router_test

import (
	"net/http"
	"testing"

	"easelect/backend/core_components/router"
)

func TestAdminLangKeyRouteContract(t *testing.T) {
	t.Setenv("ENVIRONMENT_TYPE", "production")
	t.Setenv("ENABLE_API_LANGUAGE", "")
	router.RegisterRoutes("frontend", "storage")

	const handlerName = "lang.AdminLangKeyHandler"
	for _, route := range router.GetRouteDefinitions() {
		if route.HandlerName != handlerName {
			continue
		}
		if route.UrlPattern != "/api/admin/lang-key" {
			t.Fatalf("path = %q", route.UrlPattern)
		}
		if route.MatchType != router.RouteMatchExact {
			t.Fatalf("match type = %q, want exact", route.MatchType)
		}

		contract, ok := router.GetRouteMethodContract(handlerName)
		if !ok {
			t.Fatal("method contract is missing")
		}
		if len(contract.Methods) != 1 || contract.Methods[0] != http.MethodPost {
			t.Fatalf("methods = %#v, want POST", contract.Methods)
		}

		manifest, err := router.BuildDefaultRouteManifest()
		if err != nil {
			t.Fatalf("BuildDefaultRouteManifest: %v", err)
		}
		for _, manifestRoute := range manifest.Routes {
			if manifestRoute.HandlerName != handlerName {
				continue
			}
			if len(manifestRoute.Methods) != 1 || manifestRoute.Methods[0] != http.MethodPost {
				t.Fatalf("manifest methods = %#v, want POST", manifestRoute.Methods)
			}
			for _, scenario := range manifestRoute.Scenarios {
				if scenario.ProfileName != "admin" {
					t.Fatalf("scenario %q profile = %q, want admin", scenario.Name, scenario.ProfileName)
				}
			}
			return
		}
		t.Fatal("admin language-key route is missing from manifest")
	}
	t.Fatal("admin language-key route is not registered in production")
}
