// pipeline.go
// Core pipeline execution engine that runs middleware stages sequentially per request.
// Bridges incoming HTTP requests and the composed stage chain, passing context between stages.
// Exists to provide a single execution path that short-circuits on rejection.
package pipeline

import (
	"database/sql"
	"net/http"
)

// ──────────────────────────────────────────────────────────────
// Stage represents a single step in the request processing pipeline.
// Each stage wraps the handler with its middleware function.
// ──────────────────────────────────────────────────────────────

// StageFunc is the standard middleware signature.
// It receives the current handler and route context, and returns a wrapped handler.
type StageFunc func(next http.HandlerFunc, ctx RouteContext) http.HandlerFunc

// Stage defines one step in the pipeline.
type Stage struct {
	// Name is a unique identifier for this stage (e.g. "auth", "rate_limit").
	Name string

	// Fn is the middleware function for this stage.
	Fn StageFunc

	// AlwaysEnforced means this stage runs for ALL routes, no exceptions.
	// No route profile can skip it. Use for: logging, rate limiting.
	AlwaysEnforced bool
}

// ──────────────────────────────────────────────────────────────
// RouteContext carries per-route metadata through the pipeline.
// This allows stages like WithAccessControl (which needs urlRoute
// and handlerName) to receive context without non-standard signatures.
// ──────────────────────────────────────────────────────────────

// RouteContext holds the metadata associated with a single route definition.
type RouteContext struct {
	URLPattern  string
	HandlerName string
	DB          *sql.DB
}

// ──────────────────────────────────────────────────────────────
// RouteProfile defines per-route pipeline configuration.
// It declares which optional stages a route skips.
// AlwaysEnforced stages cannot be skipped regardless of profile.
// ──────────────────────────────────────────────────────────────

// RouteProfile holds the pipeline configuration for a specific route.
type RouteProfile struct {
	// SkipStages lists stage names that this route should skip.
	// Only non-AlwaysEnforced stages can be skipped.
	SkipStages map[string]bool

	// AdminOnly marks the route as requiring admin_access_allowed = true.
	// When true, the "admin_check" stage is activated.
	AdminOnly bool
}

// DefaultProfile is used for routes that don't have a custom profile.
// It skips nothing — maximum security by default.
var DefaultProfile = RouteProfile{
	SkipStages: map[string]bool{},
}

// ──────────────────────────────────────────────────────────────
// Skips checks whether a given stage should be skipped for this profile.
// ──────────────────────────────────────────────────────────────

// Skips returns true if the profile says to skip the named stage.
func (p RouteProfile) Skips(stageName string) bool {
	return p.SkipStages[stageName]
}
