// component_assets_test.go
// Exercises the component static boundary with temporary frontend and private files.
// Connects the real file server and pre-mux guard to adversarial URL requests.
// Proves confinement, directory refusal and frontend-compatible response headers.
package frontendassets

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func componentAssetFixture(t *testing.T) (string, http.Handler) {
	t.Helper()
	root := t.TempDir()
	for _, name := range []string{
		"sample/frontend/module.js", "sample/frontend/style.css", "sample/frontend/photo.png",
		"sample/frontend/dist/main.Abc12345.min.js", "sample/frontend/config.json",
		"sample/backend/private.js", "sample/tests/fixture.js", "sample/frontend/handler_test.js",
		"sample/frontend/handler.spec.js", "sample/frontend/handler.test.js",
		"sample/frontend/.hidden.js", "sample/frontend/.hidden/module.js",
		"sample/frontend/tests/fixture.js", "sample/frontend/backend/private.js",
		"sample/frontend/source.go", "sample/frontend/source.py", "sample/frontend/source.sql",
		"sample/frontend/README.md", "sample/frontend/source.js.map",
	} {
		file := filepath.Join(root, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(file), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(file, []byte("fixture:"+name), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.MkdirAll(filepath.Join(root, "sample/frontend/directory.js"), 0700); err != nil {
		t.Fatal(err)
	}
	return root, ComponentFileServer(root)
}

func TestComponentAssetsRejectPrivateAndMalformedPaths(t *testing.T) {
	_, handler := componentAssetFixture(t)
	for _, suffix := range []string{
		"sample/backend/private.js", "sample/tests/fixture.js", "sample/frontend/handler_test.js",
		"sample/frontend/handler.spec.js", "sample/frontend/handler.test.js",
		"sample/frontend/.hidden.js", "sample/frontend/.hidden/module.js",
		"sample/frontend/tests/fixture.js", "sample/frontend/backend/private.js",
		"sample/frontend/../backend/private.js", "sample/frontend/%2e%2e%2fbackend/private.js",
		"sample/frontend/%2E%2E%2Fbackend/private.js", "sample/frontend/%252e%252e%252fbackend/private.js",
		"sample%2Ffrontend/module.js", "sample%252Ffrontend/module.js",
		"sample/frontend/%2Fmodule.js", "sample/frontend/%252Fmodule.js",
		"sample/frontend/%5cmodule.js", "sample/frontend/%255cmodule.js",
		"sample/frontend/source.go", "sample/frontend/source.py", "sample/frontend/source.sql",
		"sample/frontend/.env", "sample/frontend/README.md", "sample/frontend/source.js.map",
		"unknown/frontend/module.js", "Sample/frontend/module.js",
	} {
		t.Run(suffix, func(t *testing.T) {
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/components/"+suffix, nil))
			if response.Code != http.StatusNotFound {
				t.Fatalf("status = %d, want 404", response.Code)
			}
		})
	}
}

func TestComponentAssetsRefuseDirectoriesAndSymlinks(t *testing.T) {
	root, handler := componentAssetFixture(t)
	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "outside.js"), []byte("outside"), 0600); err != nil {
		t.Fatal(err)
	}
	for name, target := range map[string]string{
		"sample/frontend/escape.js":  filepath.Join(outside, "outside.js"),
		"sample/frontend/index.html": filepath.Join(outside, "outside.js"),
		"sample/frontend/escape":     outside,
		"sample/frontend/inside.js":  "module.js",
		"linked":                     filepath.Join(root, "sample"),
		"sample/frontend/backend.js": "../backend/private.js",
	} {
		if err := os.Symlink(target, filepath.Join(root, name)); err != nil {
			t.Fatal(err)
		}
	}
	for _, suffix := range []string{"", "sample", "sample/", "sample/frontend", "sample/frontend/",
		"sample/frontend/dist", "sample/frontend/dist/", "sample/frontend/directory.js", "sample/frontend/directory.js/",
		"sample/frontend/escape.js", "sample/frontend/escape/outside.js", "sample/frontend/inside.js",
		"sample/frontend/backend.js", "sample/frontend/index.html", "linked/frontend/module.js"} {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/components/"+suffix, nil))
		if response.Code != http.StatusNotFound {
			t.Errorf("%s: status = %d, want 404", suffix, response.Code)
		}
	}
	// Even an entire frontend directory cannot redirect delivery to backend source.
	if err := os.MkdirAll(filepath.Join(root, "linked_frontend"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(root, "sample/backend"), filepath.Join(root, "linked_frontend/frontend")); err != nil {
		t.Fatal(err)
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest("GET", "/components/linked_frontend/frontend/private.js", nil))
	if response.Code != 404 {
		t.Fatalf("symlinked frontend = %d", response.Code)
	}
}

func TestComponentAssetsGuardRunsBeforeMuxCleaning(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusTeapot) })
	for _, target := range []string{"/components", "/components/sample/frontend/../backend/private.js",
		"/components/../frontend/module.js", "/components//sample/frontend/module.js",
		"/components%2Fsample/frontend/module.js", "/components%252Fsample/frontend/module.js"} {
		response := httptest.NewRecorder()
		WithComponentAssetPathGuard(mux).ServeHTTP(response, httptest.NewRequest("GET", target, nil))
		if response.Code != 404 || response.Header().Get("Location") != "" {
			t.Errorf("%s: status = %d, location = %q", target, response.Code, response.Header().Get("Location"))
		}
	}
}

func TestComponentAssetsShareFrontendHeadersAndCaching(t *testing.T) {
	root, handler := componentAssetFixture(t)
	for _, name := range []string{"module.js", "style.css", "photo.png", "config.json", "dist/main.Abc12345.min.js"} {
		request := httptest.NewRequest(http.MethodGet, "/components/sample/frontend/"+name, nil)
		request.Header.Set("If-Modified-Since", time.Now().Add(time.Hour).UTC().Format(http.TimeFormat))
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		reference := httptest.NewRecorder()
		FileServer(filepath.Join(root, "sample/frontend")).ServeHTTP(reference, httptest.NewRequest("GET", "/"+name, nil))
		fresh := httptest.NewRecorder()
		handler.ServeHTTP(fresh, httptest.NewRequest("GET", "/components/sample/frontend/"+name, nil))
		if fresh.Code != 200 || fresh.Body.String() != reference.Body.String() ||
			fresh.Header().Get("Content-Type") != reference.Header().Get("Content-Type") {
			t.Fatalf("%s: body or extension content type differs from /frontend/", name)
		}
		if response.Header().Get("Cache-Control") != reference.Header().Get("Cache-Control") ||
			response.Header().Get("X-Content-Type-Options") != "nosniff" {
			t.Fatalf("%s: headers = %v", name, response.Header())
		}
		mutable := name == "module.js" || name == "style.css" || name == "config.json"
		if mutable && (response.Code != 200 || !strings.Contains(response.Body.String(), "fixture:")) {
			t.Fatalf("mutable %s reused cached bytes: %d", name, response.Code)
		}
		if !mutable && response.Code != 304 {
			t.Fatalf("conditional %s = %d, want 304", name, response.Code)
		}
		if mutable && response.Header().Get("Content-Type") != reference.Header().Get("Content-Type") {
			t.Fatalf("%s content type = %q, want %q", name, response.Header().Get("Content-Type"), reference.Header().Get("Content-Type"))
		}
	}
}
