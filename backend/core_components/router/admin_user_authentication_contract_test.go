// admin_user_authentication_contract_test.go
// Verifies the stable route and method declaration for administrator authentication provisioning.
// Bridges runtime route registration and generated backend route metadata.
// Exists so admin clients can depend on one explicit GET/POST endpoint.
package router_test

import (
	"net/http"
	"testing"

	"easelect/backend/core_components/router"
)

func TestAdminUserAuthenticationRouteContract(t *testing.T) {
	t.Setenv("ENVIRONMENT_TYPE", "production")
	t.Setenv("ENABLE_API_LANGUAGE", "")
	router.RegisterRoutes("frontend", "storage")

	var found bool
	for _, route := range router.GetRouteDefinitions() {
		if route.HandlerName != "auth.AdminUserAuthenticationHandler" {
			continue
		}
		found = true
		if route.UrlPattern != "/api/admin/user-authentication" {
			t.Fatalf("path = %q", route.UrlPattern)
		}
		if route.MatchType != router.RouteMatchExact {
			t.Fatalf("match type = %q, want exact", route.MatchType)
		}
	}
	if !found {
		t.Fatal("admin user authentication route is not registered")
	}

	contract, ok := router.GetRouteMethodContract("auth.AdminUserAuthenticationHandler")
	if !ok {
		t.Fatal("method contract is missing")
	}
	if contract.Source != router.RouteMethodSourceExplicitStableContract {
		t.Fatalf("contract source = %q", contract.Source)
	}
	if len(contract.Methods) != 2 || contract.Methods[0] != http.MethodGet || contract.Methods[1] != http.MethodPost {
		t.Fatalf("methods = %#v, want GET and POST", contract.Methods)
	}

	manifest, err := router.BuildDefaultRouteManifest()
	if err != nil {
		t.Fatalf("BuildDefaultRouteManifest: %v", err)
	}
	for _, route := range manifest.Routes {
		if route.HandlerName == "auth.AdminUserAuthenticationHandler" {
			if len(route.Methods) != 2 || route.Methods[0] != http.MethodGet || route.Methods[1] != http.MethodPost {
				t.Fatalf("manifest methods = %#v", route.Methods)
			}
			return
		}
	}
	t.Fatal("admin user authentication route is missing from the route manifest")
}
