// registration_test.go
// Verifies that the observatory stays dormant until private activation.
// Bridges its route registration with the administrator security pipeline.
// Exists so the private board cannot become an unauthenticated public surface.
package workline_observatory

import (
	"net/http"
	"testing"

	appregistry "easelect/backend/core_components/app_registry"
	"easelect/backend/pipeline"
)

func TestWorklineObservatoryRequiresActivationAndAdminPipeline(t *testing.T) {
	routes := map[string]string{}
	appregistry.RegisterRoutes(func(pattern string, _ http.HandlerFunc, handlerName string) {
		routes[pattern] = handlerName
	})
	if len(routes) != 0 {
		t.Fatalf("observatory registered routes before explicit activation: %#v", routes)
	}

	Register()
	appregistry.RegisterRoutes(func(pattern string, _ http.HandlerFunc, handlerName string) {
		routes[pattern] = handlerName
	})
	want := map[string]string{
		"/api/app/workline-observatory/board":          "workline_observatory.BoardHandler",
		"/api/app/workline-observatory/status-actions": "workline_observatory.WorklineStatusActionsHandler",
		"/api/app/workline-observatory/release-goals":  "workline_observatory.ReleaseGoalsHandler",
		"/api/app/workline-observatory/contracts":      "workline_observatory.ReleaseContractsHandler",
	}
	for path, handlerName := range want {
		if routes[path] != handlerName {
			t.Fatalf("%s handler = %q, want %q", path, routes[path], handlerName)
		}
		descriptor := pipeline.DescribeRouteProfile(handlerName)
		if descriptor.ProfileName != "admin" || !descriptor.AdminOnly {
			t.Fatalf("%s profile = %+v, want admin", handlerName, descriptor)
		}
	}
}
