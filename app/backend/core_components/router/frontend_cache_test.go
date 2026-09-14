// frontend_cache_test.go
// Verifies fresh source modules and unchanged versioned-asset caching.
// Connects the actual frontend route with conditional browser reload requests.
// Prevents mixed module generations from blanking the application after F5.
package router

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestFrontendModuleReloadReadsChangedBytesWithPreservedTimestamp(t *testing.T) {
	previous := localFrontendDir
	localFrontendDir = t.TempDir()
	t.Cleanup(func() { localFrontendDir = previous })
	name := filepath.Join(localFrontendDir, "dependency.js")
	modified := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	write := func(body string) {
		t.Helper()
		if err := os.WriteFile(name, []byte(body), 0600); err != nil {
			t.Fatal(err)
		}
		if err := os.Chtimes(name, modified, modified); err != nil {
			t.Fatal(err)
		}
	}
	write("export const oldValue = 1;")
	first := httptest.NewRecorder()
	handleFrontend(first, httptest.NewRequest(http.MethodGet, "/frontend/dependency.js", nil))
	write("export const newValue = 2;")
	request := httptest.NewRequest(http.MethodGet, "/frontend/dependency.js", nil)
	request.Header.Set("If-Modified-Since", first.Header().Get("Last-Modified"))
	response := httptest.NewRecorder()
	handleFrontend(response, request)
	if response.Code != http.StatusOK || response.Body.String() != "export const newValue = 2;" {
		t.Fatalf("reload = %d %q; want current module bytes", response.Code, response.Body.String())
	}
	if got := response.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("Cache-Control = %q; want no-store", got)
	}
}

func TestFrontendVersionedAndImageAssetsKeepConditionalServing(t *testing.T) {
	previous := localFrontendDir
	localFrontendDir = t.TempDir()
	t.Cleanup(func() { localFrontendDir = previous })
	for _, name := range []string{"dist/main.Abc123_-.min.js", "photo.png"} {
		file := filepath.Join(localFrontendDir, name)
		if err := os.MkdirAll(filepath.Dir(file), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(file, []byte("content"), 0600); err != nil {
			t.Fatal(err)
		}
		request := httptest.NewRequest(http.MethodGet, "/frontend/"+name, nil)
		request.Header.Set("If-Modified-Since", time.Now().Add(time.Hour).UTC().Format(http.TimeFormat))
		response := httptest.NewRecorder()
		handleFrontend(response, request)
		if response.Code != http.StatusNotModified || response.Header().Get("Cache-Control") != "" {
			t.Fatalf("%s: status=%d cache=%q", name, response.Code, response.Header().Get("Cache-Control"))
		}
	}
}
