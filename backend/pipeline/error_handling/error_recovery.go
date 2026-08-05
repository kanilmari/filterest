// error_recovery.go
// Pipeline stage that recovers from panics and unhandled errors in downstream handlers.
// Bridges the pipeline execution chain and error-response formatting.
// Exists to log unexpected failures and return structured error responses to clients.
package error_handling

import (
	"easelect/backend/core_components/httpresponse"
	"log"
	"net/http"
	"runtime/debug"
)

// WithErrorRecovery catches panics from downstream handlers and middleware stages.
// It writes a structured JSON 500 response and logs the panic with:
// - HTTP method and URL path
// - Handler name (from pipeline RouteContext)
// - The panic value
// - Full goroutine stack trace
//
// Usage in pipeline_order.go:
//
//	{Name: "error_handling", AlwaysEnforced: true, Fn: func(next http.HandlerFunc, ctx RouteContext) http.HandlerFunc {
//	    return error_handling.WithErrorRecovery(ctx.HandlerName, next)
//	}}
func WithErrorRecovery(handlerName string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				stack := debug.Stack()

				log.Printf(
					"\n\033[31m[ERROR_RECOVERY] PANIC in %s %s (handler: %s)\033[0m\n"+
						"  Panic value: %v\n"+
						"  Remote addr: %s\n"+
						"  User-Agent:  %s\n"+
						"  Stack trace:\n%s",
					r.Method, r.URL.Path, handlerName,
					rec,
					r.RemoteAddr,
					r.UserAgent(),
					stack,
				)

				httpresponse.RespondWithError(w, http.StatusInternalServerError, "Internal Server Error")
			}
		}()
		next(w, r)
	}
}
