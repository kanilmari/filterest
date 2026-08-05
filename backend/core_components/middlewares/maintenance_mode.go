// maintenance_mode.go
// Middleware that intercepts all requests when maintenance mode is active.
// Bridges the system_config maintenance flag and the HTTP response chain.
// Exists to show a maintenance page to non-admin users while allowing admin access.
package middlewares

import (
	"context"
	backend "easelect/backend/core_components"
	_ "embed"
	"net/http"
	"os"
	"strings"
	"sync/atomic"
)

//go:embed maintenance_page.html
var maintenancePageHTML string

// maintenanceRendered is the HTML with {{SITE_NAME}} replaced by the
// actual site name.  Built once at startup by InitMaintenanceMode.
var maintenanceRendered string

// maintenanceActive caches the env-var check so we don't hit os.Getenv on
// every single request.  It is set once at startup via InitMaintenanceMode
// and can be toggled at runtime via SetMaintenanceMode (e.g. from an admin
// endpoint in the future).
var maintenanceActive atomic.Bool

var configuredMaintenanceSiteNameReader = backend.ConfiguredSiteName

// InitMaintenanceMode reads the maintenance toggle and resolves the saved site
// identity before deployment fallbacks, then pre-renders the HTML page.
// Call this once during startup (before ListenAndServe).
func InitMaintenanceMode() {
	val := strings.ToLower(strings.TrimSpace(os.Getenv("MAINTENANCE_MODE")))
	maintenanceActive.Store(val == "true" || val == "1")

	siteName := configuredMaintenanceSiteNameReader(context.Background(), backend.Db)
	if siteName == "" {
		siteName = os.Getenv("SITE_NAME")
	}
	if siteName == "" {
		siteName = "Easelect"
	}
	maintenanceRendered = strings.ReplaceAll(maintenancePageHTML, "{{SITE_NAME}}", siteName)
}

// SetMaintenanceMode allows toggling maintenance mode at runtime.
func SetMaintenanceMode(active bool) {
	maintenanceActive.Store(active)
}

// IsMaintenanceMode returns whether maintenance mode is currently active.
func IsMaintenanceMode() bool {
	return maintenanceActive.Load()
}

// WithMaintenanceMode wraps the next handler.  When maintenance mode is
// active, browser page navigations receive 200 + maintenance HTML (to
// avoid red console errors), while API/XHR calls receive a proper 503
// so programmatic clients can detect the outage.  Favicons get 204.
func WithMaintenanceMode(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if maintenanceActive.Load() {
			// Serve a minimal valid response for common browser-initiated
			// requests that would otherwise show as console errors.
			path := r.URL.Path
			if path == "/favicon.ico" || path == "/favicon4S.png" {
				w.Header().Set("Cache-Control", "no-store")
				w.WriteHeader(http.StatusNoContent) // 204 — valid, no body
				return
			}

			// Distinguish browser navigation from API/XHR calls:
			// - API paths (/api/) always get 503
			// - Requests with Accept: text/html (browser navigation) get 200
			// - Everything else gets 503
			isAPI := strings.HasPrefix(path, "/api/")
			acceptsHTML := strings.Contains(r.Header.Get("Accept"), "text/html")

			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.Header().Set("Retry-After", "300")
			if isAPI || !acceptsHTML {
				w.WriteHeader(http.StatusServiceUnavailable) // 503 for APIs
			} else {
				w.WriteHeader(http.StatusOK) // 200 for browser navigation
			}
			w.Write([]byte(maintenanceRendered))
			return
		}
		next.ServeHTTP(w, r)
	})
}
