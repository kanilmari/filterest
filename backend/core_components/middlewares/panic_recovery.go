// panic_recovery.go
// Middleware that recovers from panics in HTTP handlers.
// Bridges the Go runtime panic recovery and structured HTTP error responses.
// Exists to log stack traces and return 500 errors instead of crashing the server.
package middlewares

import (
	"easelect/backend/core_components/httpresponse"
	"log"
	"net/http"
	"runtime/debug"
)

// WithPanicRecovery wraps the next handler with panic recovery.
// If a panic occurs, it logs the error with stack trace and returns
// a structured JSON 500 response instead of crashing the server.
//
// This is the global wrapper in main.go. Per-route error recovery
// with handler-name context is handled by WithErrorRecovery (error_recovery.go)
// via the pipeline error_handling stage.
func WithPanicRecovery(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				stack := debug.Stack()
				log.Printf(
					"\n\033[31m[PANIC_RECOVERY] Global panic in %s %s\033[0m\n"+
						"  Panic value: %v\n"+
						"  Remote addr: %s\n"+
						"  Stack trace:\n%s",
					r.Method, r.URL.Path,
					rec,
					r.RemoteAddr,
					stack,
				)
				httpresponse.RespondWithError(w, http.StatusInternalServerError, "Internal Server Error")
			}
		}()
		next.ServeHTTP(w, r)
	})
}
