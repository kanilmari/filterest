// db_role_profiles_test.go
// Checks explicit profiles for database-role routes in the startup registry.
// Connects development overrides to route completeness and middleware stages.
// Prevents development SQL tools from weakening any existing authorization.
package pipeline_test

import (
	"reflect"
	"strings"
	"testing"

	"easelect/backend/core_components/router"
	"easelect/backend/pipeline"
)

func TestDatabaseRoleDevelopmentProfilesAndCompleteness(t *testing.T) {
	t.Cleanup(pipeline.ResetRouteProfiles)
	t.Cleanup(router.ResetRouteDefinitions)
	for _, environment := range []string{"production", "dev"} {
		t.Run(environment, func(t *testing.T) {
			t.Setenv("ENVIRONMENT_TYPE", environment)
			pipeline.ResetRouteProfiles()
			before := map[string]pipeline.RouteProfile{}
			for name, profile := range pipeline.RouteProfiles {
				before[name] = profile
			}
			pipeline.ApplyDevOverrides()
			for name, profile := range before {
				if !reflect.DeepEqual(profile, pipeline.GetProfile(name)) {
					t.Errorf("development overrides changed existing profile %s", name)
				}
			}
			router.RegisterRoutes(t.TempDir(), t.TempDir())
			roleCount := 0
			for _, route := range router.GetRouteDefinitions() {
				profile, exists := pipeline.RouteProfiles[route.HandlerName]
				if !exists {
					t.Errorf("registered route lacks explicit profile: %s", route.HandlerName)
				}
				if !strings.HasPrefix(route.HandlerName, "db_admin.") {
					continue
				}
				roleCount++
				if environment != "dev" || !reflect.DeepEqual(profile, pipeline.AdminProfile) {
					t.Errorf("SQL role route %s must be development-only with AdminProfile", route.UrlPattern)
				}
				containsAll(t, pipeline.DescribePipeline(pipeline.RouteContext{}, profile),
					[]string{"auth", "csrf", "fingerprint", "device_id", "access_control", "admin_check"})
			}
			if environment == "dev" && roleCount != 4 {
				t.Fatalf("development SQL role routes=%d, want 4", roleCount)
			}
		})
	}
}
