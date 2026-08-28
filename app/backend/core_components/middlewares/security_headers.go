// security_headers.go
// Middleware that adds standard security headers to all HTTP responses.
// Bridges the response writer and downstream handlers with HSTS, X-Frame-Options, etc.
// Exists to harden the application against common web attacks via header-based defences.
package middlewares

import "net/http"

// WithSecurityHeaders adds common security headers to each HTTP response.
func WithSecurityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Strict-Transport-Security", "max-age=63072000; includeSubDomains")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		next.ServeHTTP(w, r)
	})
}
