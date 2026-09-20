// coding_agent_route_contract_test.go
// Keeps both coding-agent discovery and execution behind the existing admin profile.
// Bridges route registration and generated method/profile metadata.
// Prevents production opt-in from widening access to ordinary users.
package router_test

import (
	"easelect/backend/core_components/router"
	"net/http"
	"testing"
)

func TestCodingAgentGETAndPOSTRemainAdminOnly(t *testing.T) {
	t.Setenv("ENVIRONMENT_TYPE", "prod")
	router.RegisterRoutes("frontend", "storage")
	manifest, err := router.BuildDefaultRouteManifest()
	if err != nil {
		t.Fatal(err)
	}
	for _, route := range manifest.Routes {
		if route.HandlerName != "dtt_1_row_read.FilterbarAICodexQueryHandler" {
			continue
		}
		if route.PathPattern != "/api/app/ai-chat/codex-query" {
			t.Fatal(route.PathPattern)
		}
		if len(route.Methods) != 3 || route.Methods[0] != http.MethodGet ||
			route.Methods[1] != http.MethodHead || route.Methods[2] != http.MethodPost {
			t.Fatal(route.Methods)
		}
		for _, scenario := range route.Scenarios {
			if scenario.ProfileName != "admin" {
				t.Fatal(scenario.ProfileName)
			}
		}
		return
	}
	t.Fatal("coding agent route missing")
}
