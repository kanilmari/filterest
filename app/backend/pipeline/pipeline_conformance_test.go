// pipeline_conformance_test.go
// Conformance test: verifies that every registered route has an explicit entry in pipeline.RouteProfiles.
// This prevents routes from silently falling back to DefaultProfile without a deliberate, documented decision.
// Run with: go test ./backend/pipeline/ -run TestRouteProfilesConformance
package pipeline_test

import (
	"os"
	"strings"
	"testing"

	"easelect/backend/core_components/router"
	"easelect/backend/pipeline"
)

// TestRouteProfilesConformance checks that every HandlerName in routeDefinitions
// has an explicit entry in pipeline.RouteProfiles. Routes that legitimately use
// DefaultProfile must still be listed explicitly so the decision is documented.
func TestRouteProfilesConformance(t *testing.T) {
	// Enable conditional routes so they are also verified.
	os.Setenv("ENABLE_API_LANGUAGE", "true")
	defer os.Unsetenv("ENABLE_API_LANGUAGE")

	// Populate routeDefinitions from a fresh in-memory route registry.
	router.RegisterRoutes("frontend", "storage")

	// Apply dev overrides — this is part of the normal startup path
	// (called by RegisterAllRoutesAndUpdateFunctions) and registers
	// dev tool profiles into RouteProfiles when in dev environment.
	pipeline.ResetRouteProfiles()
	pipeline.ApplyDevOverrides()

	routes := router.GetRouteDefinitions()
	if len(routes) == 0 {
		t.Fatal("RegisterRoutes returned zero route definitions — nothing to check")
	}

	// Deduplicate handler names (RegisterRoutes may be called by other tests).
	seen := make(map[string]bool)
	var missing []string

	for _, r := range routes {
		if seen[r.HandlerName] {
			continue
		}
		seen[r.HandlerName] = true

		if _, ok := pipeline.RouteProfiles[r.HandlerName]; !ok {
			missing = append(missing, r.HandlerName)
		}
	}

	if len(missing) > 0 {
		t.Errorf(
			"%d route(s) are missing from pipeline.RouteProfiles.\n"+
				"Add each handler to route_profiles.go with the correct profile\n"+
				"(use DefaultProfile explicitly if that is intentional).\n\n"+
				"Missing handlers:\n  %s",
			len(missing),
			strings.Join(missing, "\n  "),
		)
	}

	t.Logf("Conformance OK: %d routes checked, %d explicitly profiled",
		len(seen), len(seen)-len(missing))
}
