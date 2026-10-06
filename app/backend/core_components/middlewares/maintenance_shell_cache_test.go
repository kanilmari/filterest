// maintenance_shell_cache_test.go
// Checks every maintenance response is uncacheable, including failed boot assets.
// Bridges the outer maintenance middleware and document/subresource requests.
// Prevents a maintenance response from surviving the outage in browser cache.
package middlewares

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestMaintenanceResponsesNoStore(t *testing.T) {
	previous := IsMaintenanceMode()
	SetMaintenanceMode(true)
	t.Cleanup(func() { SetMaintenanceMode(previous) })
	for _, path := range []string{"/", "/frontend/main.js", "/api/results", "/favicon.ico"} {
		r := httptest.NewRequest(http.MethodGet, path, nil)
		if path == "/" {
			r.Header.Set("Accept", "text/html")
		}
		response := httptest.NewRecorder()
		WithMaintenanceMode(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { t.Fatal("maintenance reached downstream") })).ServeHTTP(response, r)
		if response.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("%s: cacheable", path)
		}
	}
}
