// site_presentation_settings_contract_test.go
// Verifies the public read and administrator write route security contract.
// Exists so persisted visual settings cannot widen into public configuration writes.
package router_test

import (
	"net/http"
	"testing"

	"easelect/backend/core_components/router"
)

func TestSitePresentationSettingsRouteContract(t *testing.T) {
	t.Setenv("ENVIRONMENT_TYPE", "production")
	t.Setenv("ENABLE_API_LANGUAGE", "")
	router.RegisterRoutes("frontend", "storage")
	definitions := append([]router.RouteDefinition{}, router.GetRouteDefinitions()...)

	expectations := map[string]struct {
		path    string
		profile string
		methods []string
	}{
		"system_table_tools.GetSitePresentationSettingsHandler": {
			path: "/api/site-presentation-settings", profile: "public", methods: []string{http.MethodGet},
		},
		"system_table_tools.AdminSitePresentationSettingsHandler": {
			path: "/api/admin/site-presentation-settings", profile: "admin", methods: []string{http.MethodGet, http.MethodPost},
		},
	}

	manifest, err := router.BuildDefaultRouteManifest()
	if err != nil {
		t.Fatalf("BuildDefaultRouteManifest: %v", err)
	}
	for handlerName, expected := range expectations {
		foundDefinition := false
		for _, route := range definitions {
			if route.HandlerName != handlerName {
				continue
			}
			foundDefinition = true
			if route.UrlPattern != expected.path || route.MatchType != router.RouteMatchExact {
				t.Fatalf("%s route = %q/%q", handlerName, route.UrlPattern, route.MatchType)
			}
		}
		if !foundDefinition {
			t.Fatalf("%s route definition is missing", handlerName)
		}

		contract, ok := router.GetRouteMethodContract(handlerName)
		if !ok {
			t.Fatalf("%s method contract is missing", handlerName)
		}
		if !equalStringSlices(contract.Methods, expected.methods) {
			t.Fatalf("%s methods = %#v, want %#v", handlerName, contract.Methods, expected.methods)
		}

		foundManifest := false
		for _, route := range manifest.Routes {
			if route.HandlerName != handlerName {
				continue
			}
			foundManifest = true
			if !equalStringSlices(route.Methods, expected.methods) {
				t.Fatalf("%s manifest methods = %#v, want %#v", handlerName, route.Methods, expected.methods)
			}
			for _, scenario := range route.Scenarios {
				if scenario.ProfileName != expected.profile {
					t.Fatalf("%s scenario %q profile = %q, want %q", handlerName, scenario.Name, scenario.ProfileName, expected.profile)
				}
			}
		}
		if !foundManifest {
			t.Fatalf("%s manifest route is missing", handlerName)
		}
	}
}

func equalStringSlices(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}
