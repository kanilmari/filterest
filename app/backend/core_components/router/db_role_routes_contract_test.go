// db_role_routes_contract_test.go
// Checks database-role routes against the actual environment-sensitive registry.
// Connects route methods and condition metadata to the effective admin pipeline.
// Prevents SQL administration from being exposed outside explicit development.
package router

import (
	"net/http"
	"reflect"
	"slices"
	"testing"

	"easelect/backend/pipeline"
)

func TestDatabaseRoleRoutesOnlyInDevelopment(t *testing.T) {
	t.Cleanup(ResetRouteDefinitions)
	t.Cleanup(pipeline.ResetRouteProfiles)
	want := map[string]struct {
		handler string
		methods []string
	}{
		"/api/db-roles":        {"db_admin.ListRolesHandler", []string{http.MethodGet, http.MethodHead}},
		"/api/db-roles/create": {"db_admin.CreateRoleHandler", []string{http.MethodPost}},
		"/api/db-roles/update": {"db_admin.UpdateRoleHandler", []string{http.MethodPost}},
		"/api/db-roles/delete": {"db_admin.DeleteRoleHandler", []string{http.MethodPost}},
	}
	for _, environment := range []string{"", "production", "prod", "test", "staging", "DEV", "dev"} {
		t.Run("environment="+environment, func(t *testing.T) {
			t.Setenv("ENVIRONMENT_TYPE", environment)
			RegisterRoutes(t.TempDir(), t.TempDir())
			pipeline.ResetRouteProfiles()
			pipeline.ApplyDevOverrides()
			found := map[string]bool{}
			for _, route := range GetRouteDefinitions() {
				expected, isRoleRoute := want[route.UrlPattern]
				if !isRoleRoute {
					continue
				}
				if environment != "dev" {
					t.Errorf("SQL role route %s registered outside development", route.UrlPattern)
					continue
				}
				if found[route.UrlPattern] {
					t.Errorf("duplicate route %s", route.UrlPattern)
				}
				found[route.UrlPattern] = true
				if route.HandlerName != expected.handler || !slices.Equal(route.Methods, expected.methods) {
					t.Errorf("route %s: handler=%s methods=%v", route.UrlPattern, route.HandlerName, route.Methods)
				}
				if route.ConditionalSource != "ENVIRONMENT_TYPE='dev'" {
					t.Errorf("route %s: condition=%q", route.UrlPattern, route.ConditionalSource)
				}
				profile, explicit := pipeline.RouteProfiles[route.HandlerName]
				if !explicit || !reflect.DeepEqual(profile, pipeline.AdminProfile) {
					t.Errorf("route %s must explicitly retain AdminProfile", route.UrlPattern)
				}
				if err := validateRouteMethodContract(route); err != nil {
					t.Error(err)
				}
			}
			if environment == "dev" && len(found) != len(want) {
				t.Fatalf("development has %d role routes, want %d", len(found), len(want))
			}
		})
	}
}
