// build_pipeline.go
// Assembles the full HTTP middleware pipeline from individual stage functions.
// Bridges route registrations and the ordered stage chain (auth, CSRF, access control, etc.).
// Exists to compose stages in sequence and return the final handler chain for each route.
package pipeline

import (
	"log"
	"net/http"
)

// BuildHandler constructs the final http.HandlerFunc for a route by wrapping
// the handler through all applicable pipeline stages.
//
// The stages are applied in REVERSE order so that the first stage in
// PipelineOrder becomes the outermost wrapper (first to execute on request).
//
// Example: stages [rate_limit, logging, auth, handler]
// Wrapping: rate_limit( logging( auth( handler ) ) )
func BuildHandler(handler http.HandlerFunc, ctx RouteContext, profile RouteProfile) http.HandlerFunc {
	// Collect the stages that apply to this route
	activeStages := resolveActiveStages(ctx, profile)

	// Wrap from innermost (last) to outermost (first)
	wrapped := handler
	for i := len(activeStages) - 1; i >= 0; i-- {
		stage := activeStages[i]
		wrapped = stage.Fn(wrapped, ctx)
	}

	return wrapped
}

// resolveActiveStages returns the ordered list of stages that will be applied
// for the given route profile. It respects AlwaysEnforced flags and the admin_check
// special case (only active when profile.AdminOnly is true).
func resolveActiveStages(ctx RouteContext, profile RouteProfile) []Stage {
	var active []Stage

	for _, stage := range PipelineOrder {
		// admin_check is opt-in: only active when profile.AdminOnly is true
		if stage.Name == "admin_check" && !profile.AdminOnly {
			continue
		}

		// AlwaysEnforced stages are always included
		if stage.AlwaysEnforced {
			active = append(active, stage)
			continue
		}

		// Optional stages can be skipped by the route profile
		if profile.Skips(stage.Name) {
			continue
		}

		active = append(active, stage)
	}

	return active
}

// DescribePipeline returns the list of stage names that are active for a given
// route profile. Useful for introspection and debugging.
func DescribePipeline(ctx RouteContext, profile RouteProfile) []string {
	stages := resolveActiveStages(ctx, profile)
	names := make([]string, 0, len(stages)+1)
	for _, s := range stages {
		names = append(names, s.Name)
	}
	names = append(names, "handler")
	return names
}

// LogPipeline logs the active stages for a route at startup time.
func LogPipeline(ctx RouteContext, profile RouteProfile) {
	names := DescribePipeline(ctx, profile)
	log.Printf("[Pipeline] %s → %v", ctx.HandlerName, names)
}
