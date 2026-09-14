// file_server_test.go
// Checks browser-code caching without changing fingerprinted bundles or media.
// Exercises real static responses, HTTP validators and extension mount paths.
// Prevents stale module generations without mutating a caller's request.
package frontendassets

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestFileServerMutableAssetsIgnoreOldValidatorsAndKeepRequestIntact(t *testing.T) {
	for _, name := range []string{"module.js", "module.mjs", "styles/main.css", "data.json", "entry.html", "dist/site_presentation_bootstrap.js"} {
		t.Run(name, func(t *testing.T) {
			directory := t.TempDir()
			file := filepath.Join(directory, name)
			if err := os.MkdirAll(filepath.Dir(file), 0700); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(file, []byte("current bytes"), 0600); err != nil {
				t.Fatal(err)
			}
			for _, method := range []string{http.MethodGet, http.MethodHead} {
				request := httptest.NewRequest(method, "/"+name+"?v=old", nil)
				modified := time.Now().Add(time.Hour).UTC().Format(http.TimeFormat)
				request.Header.Set("If-Modified-Since", modified)
				request.Header.Set("If-None-Match", "*")
				response := httptest.NewRecorder()
				FileServer(directory).ServeHTTP(response, request)
				if response.Code != http.StatusOK || response.Header().Get("Cache-Control") != "no-store" {
					t.Fatalf("%s: status=%d cache=%q", method, response.Code, response.Header().Get("Cache-Control"))
				}
				if method == http.MethodGet && response.Body.String() != "current bytes" {
					t.Fatal("stale or absent module bytes")
				}
				if method == http.MethodHead && response.Body.Len() != 0 {
					t.Fatal("HEAD returned a body")
				}
				if request.Header.Get("If-Modified-Since") != modified || request.Header.Get("If-None-Match") != "*" {
					t.Fatal("request headers were changed for another middleware")
				}
			}
		})
	}
}

func TestMutableBrowserAssetClassification(t *testing.T) {
	for _, name := range []string{"/photo.png", "/font.woff2", "/dist/main.Abc123_-.min.js", "/dist/imports.12345678.min.css"} {
		if isMutableBrowserAsset(name) {
			t.Errorf("%s should keep normal asset caching", name)
		}
	}
	for _, name := range []string{"/main.js", "/dist/main.min.js", "/dist/main.short.min.js", "/source/main.Abc123_-.min.js", "/dist/../main.js"} {
		if !isMutableBrowserAsset(name) {
			t.Errorf("%s must not retain a stable browser-code URL", name)
		}
	}
}
