// file_server_test.go
// Checks browser-code caching without changing fingerprinted bundles or media.
// Exercises real static responses, HTTP validators and extension mount paths.
// Prevents stale module generations without mutating a caller's request.
package frontendassets

import (
	"bytes"
	"crypto/sha256"
	"fmt"
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

func TestHomeDarkPNGRevalidatesContentForGETAndHEAD(t *testing.T) {
	root := t.TempDir()
	const name = "icons/site_favicons/site-test-128-dark-v1.png"
	file := filepath.Join(root, name)
	if err := os.MkdirAll(filepath.Dir(file), 0700); err != nil {
		t.Fatal(err)
	}
	date := time.Date(2026, 10, 20, 12, 0, 0, 0, time.UTC)
	handler := FileServer(root)
	var etag string
	for _, content := range [][]byte{[]byte("first PNG bytes"), []byte("other PNG bytes")} {
		if err := os.WriteFile(file, content, 0600); err != nil {
			t.Fatal(err)
		}
		if err := os.Chtimes(file, date, date); err != nil {
			t.Fatal(err)
		}
		oldETag := etag
		etag = fmt.Sprintf(`"%x"`, sha256.Sum256(content))
		for _, method := range []string{http.MethodGet, http.MethodHead} {
			for _, validator := range []string{"", oldETag, etag} {
				request := httptest.NewRequest(method, "/"+name, nil)
				request.Header.Set("If-Modified-Since", date.Add(time.Hour).Format(http.TimeFormat))
				if validator != "" {
					request.Header.Set("If-None-Match", validator)
				}
				response := httptest.NewRecorder()
				handler.ServeHTTP(response, request)
				wantStatus := http.StatusOK
				if validator == etag {
					wantStatus = http.StatusNotModified
				}
				if response.Code != wantStatus || response.Header().Get("ETag") != etag || response.Header().Get("Cache-Control") != "public, no-cache" {
					t.Fatalf("%s validator=%s: %d %v", method, validator, response.Code, response.Header())
				}
				if wantStatus == http.StatusOK && response.Header().Get("Content-Type") != "image/png" {
					t.Fatal(response.Header())
				}
				if method == http.MethodGet && wantStatus == http.StatusOK && !bytes.Equal(response.Body.Bytes(), content) {
					t.Fatal("stale bytes")
				}
				if method == http.MethodHead || wantStatus == http.StatusNotModified {
					if response.Body.Len() != 0 {
						t.Fatal("unexpected response body")
					}
				}
				if method == http.MethodHead && wantStatus == http.StatusOK && response.Header().Get("Content-Length") != fmt.Sprint(len(content)) {
					t.Fatal("HEAD size")
				}
			}
		}
		// The real router strips /frontend/, leaving no leading slash.
		mounted := httptest.NewRecorder()
		http.StripPrefix("/frontend/", handler).ServeHTTP(mounted, httptest.NewRequest(http.MethodGet, "/frontend/"+name, nil))
		if mounted.Code != http.StatusOK || mounted.Header().Get("ETag") != etag {
			t.Fatalf("mounted dark route: %d %v", mounted.Code, mounted.Header())
		}
	}
}

func TestHomeDarkPNGServerRefusesUnsafeNonRegularAndSymlinkPaths(t *testing.T) {
	root := t.TempDir()
	directory := filepath.Join(root, "icons", "site_favicons")
	if err := os.MkdirAll(directory, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, "target.png"), []byte("target"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("target.png", filepath.Join(directory, "linked-128-dark-v1.png")); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(directory, "folder-128-dark-v1.png"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "outside-128-dark-v1.png"), []byte("outside"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, "plain-128-dark-v1.png"), []byte("plain"), 0600); err != nil {
		t.Fatal(err)
	}
	canonical := httptest.NewRecorder()
	FileServer(root).ServeHTTP(canonical, httptest.NewRequest(http.MethodGet, "/icons/site_favicons/plain-128-dark-v1.png", nil))
	if canonical.Code != http.StatusOK || canonical.Header().Get("Cache-Control") != "public, no-cache" {
		t.Fatalf("canonical dark PNG: %d %v", canonical.Code, canonical.Header())
	}
	paths := []string{"/icons/site_favicons/linked-128-dark-v1.png", "/icons/site_favicons/folder-128-dark-v1.png", "/icons/site_favicons/missing-128-dark-v1.png", "/icons/site_favicons/../../outside-128-dark-v1.png", "/outside-128-dark-v1.png"}
	// Aliases that clean to a dark name must not reach the ordinary handler.
	for _, name := range []string{"linked", "plain"} {
		file := "/icons/site_favicons/" + name + "-128-dark-v1.png"
		paths = append(paths, file+"/", file+"/.", "/icons/site_favicons//"+name+"-128-dark-v1.png", "/icons/site_favicons/./"+name+"-128-dark-v1.png")
	}
	for _, path := range paths {
		for _, method := range []string{http.MethodGet, http.MethodHead} {
			response := httptest.NewRecorder()
			FileServer(root).ServeHTTP(response, httptest.NewRequest(method, path, nil))
			if response.Code != http.StatusNotFound {
				t.Fatalf("%s %s: %d", method, path, response.Code)
			}
		}
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
