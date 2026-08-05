// pipeline_order.go
// Defines the canonical ordering of pipeline stages per security profile.
// Bridges route profiles and the individual stage packages into an ordered execution list.
// Exists to specify which middleware stages run and in what sequence for each profile.
package pipeline

import (
	"easelect/backend/pipeline/access_control"
	"easelect/backend/pipeline/admin_check"
	"easelect/backend/pipeline/audit"
	"easelect/backend/pipeline/auth_check"
	"easelect/backend/pipeline/csrf_check"
	"easelect/backend/pipeline/device_id_check"
	"easelect/backend/pipeline/error_handling"
	"easelect/backend/pipeline/fingerprint_check"
	"easelect/backend/pipeline/lazy_transaction"
	"easelect/backend/pipeline/rate_limiting"
	"easelect/backend/pipeline/request_logging"
	"easelect/backend/pipeline/request_size_limit"
	"net/http"
)

// PipelineOrder lists every middleware stage in execution order.
// Stages wrap from last to first: the first stage in this slice
// becomes the outermost wrapper (executed first on request, last on response).
//
// Pipeline order is presented below. The order is carefully designed to ensure security, performance, and correct behavior.

// An ice cream kiosk metaphor (just 4 short steps for simplicity):
// 1. The customer approaches the kiosk (rate_limit) — if too many customers are waiting, they get a "busy" message and leave.
// 2. The kiosk checks bag size (request_size_limit) — oversized luggage is rejected immediately.
// 3. The customer is greeted and asked for their order (logging) — the kiosk logs their presence and order details for analytics.
// 4. The customer pays and receives their ice cream (auth, access_control, etc.) — we check if they have the right permissions for their order (e.g. age verification for certain flavors).

// Different customer, different request, but they all flow through the same steps in the same order. The difference is that some customers might skip payment (public routes) or get extra checks (admin routes), but they still go through the same pipeline stages in the same sequence.

var PipelineOrder = []Stage{
	{
		Name:           "rate_limit",
		AlwaysEnforced: true,
		Fn: func(next http.HandlerFunc, ctx RouteContext) http.HandlerFunc {
			return rate_limiting.WithFunctionRateLimiting(ctx.DB, ctx.HandlerName, next)
		},
	},
	{
		Name:           "request_size_limit",
		AlwaysEnforced: true,
		Fn: func(next http.HandlerFunc, ctx RouteContext) http.HandlerFunc {
			return request_size_limit.WithRequestSizeLimit(ctx.HandlerName, next)
		},
	},
	{
		Name:           "logging",
		AlwaysEnforced: true,
		Fn: func(next http.HandlerFunc, ctx RouteContext) http.HandlerFunc {
			return request_logging.LogUserRequest(next)
		},
	},
	{
		Name:           "error_handling",
		AlwaysEnforced: true,
		Fn: func(next http.HandlerFunc, ctx RouteContext) http.HandlerFunc {
			return error_handling.WithErrorRecovery(ctx.HandlerName, next)
		},
	},
	{
		Name:           "auth",
		AlwaysEnforced: false,
		Fn: func(next http.HandlerFunc, ctx RouteContext) http.HandlerFunc {
			return auth_check.EnsureLoggedIn(next)
		},
	},
	{
		Name:           "csrf",
		AlwaysEnforced: false,
		Fn: func(next http.HandlerFunc, ctx RouteContext) http.HandlerFunc {
			return csrf_check.WithCSRFCheck(next)
		},
	},
	{
		Name:           "fingerprint",
		AlwaysEnforced: false,
		Fn: func(next http.HandlerFunc, ctx RouteContext) http.HandlerFunc {
			return fingerprint_check.WithFingerprintCheck(next)
		},
	},
	{
		Name:           "device_id",
		AlwaysEnforced: false,
		Fn: func(next http.HandlerFunc, ctx RouteContext) http.HandlerFunc {
			return device_id_check.WithDeviceIDCheck(next)
		},
	},
	{
		Name:           "access_control",
		AlwaysEnforced: false,
		Fn: func(next http.HandlerFunc, ctx RouteContext) http.HandlerFunc {
			return access_control.WithAccessControl(ctx.URLPattern, ctx.HandlerName, next)
		},
	},
	{
		Name:           "admin_check",
		AlwaysEnforced: false,
		Fn: func(next http.HandlerFunc, ctx RouteContext) http.HandlerFunc {
			return admin_check.WithAdminUserCheck(next)
		},
	},
	{
		Name:           "transaction",
		AlwaysEnforced: false,
		Fn: func(next http.HandlerFunc, ctx RouteContext) http.HandlerFunc {
			return lazy_transaction.WithLazyTx(next)
		},
	},
	{
		Name:           "audit",
		AlwaysEnforced: true,
		Fn: func(next http.HandlerFunc, ctx RouteContext) http.HandlerFunc {
			return audit.WithAudit(ctx.HandlerName, next)
		},
	},

	// ──────────────────────────────────────────────────────────
	// Future stages (uncomment when implemented):
	//
	// {Name: "validation",    AlwaysEnforced: false, Fn: ...},  // Request body validation
	// {Name: "notification",  AlwaysEnforced: false, Fn: ...},  // Event notifications
	// ──────────────────────────────────────────────────────────
}
