// apps_static_boundary_test.go
// Verifies the public runtime's fail-closed /apps namespace.
// Bridges reserved application URLs with the public HTTP routing boundary.
// Exists so filesystem paths can never become an implicit extension gateway.
package router

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHandleAppsFailsClosedForEveryFilesystemPath(t *testing.T) {
	t.Parallel()

	paths := []string{
		"/apps/",
		"/apps/example/backend/service.go",
		"/apps/example/.env",
		"/apps/example/credentials.json",
		"/apps/example/frontend/",
	}
	for _, path := range paths {
		path := path
		t.Run(path, func(t *testing.T) {
			t.Parallel()

			req := httptest.NewRequest(http.MethodGet, path, nil)
			rr := httptest.NewRecorder()
			handleApps(rr, req)

			if rr.Code != http.StatusNotFound {
				t.Fatalf("status = %d, want %d", rr.Code, http.StatusNotFound)
			}
			if got := rr.Header().Get("Cache-Control"); got != "no-store" {
				t.Fatalf("Cache-Control = %q, want no-store", got)
			}
		})
	}
}
