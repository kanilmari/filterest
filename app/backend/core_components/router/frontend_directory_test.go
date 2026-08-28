// frontend_directory_test.go
// Verifies disjoint frontend extension directory registration and path safety.
// Bridges optional browser extensions with the public static frontend route pipeline.
// Exists so extension source can remain outside the canonical Filterest subtree.
package router

import (
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestRegisterFrontendDirectoryServesOnlyTheMountedChildPrefix(t *testing.T) {
	ResetRouteDefinitions()
	t.Cleanup(ResetRouteDefinitions)

	directory := t.TempDir()
	if err := os.WriteFile(filepath.Join(directory, "register.js"), []byte("export {};\n"), 0o644); err != nil {
		t.Fatalf("os.WriteFile() error = %v", err)
	}
	if err := RegisterFrontendDirectory("/frontend/extension_tools/", directory); err != nil {
		t.Fatalf("RegisterFrontendDirectory() error = %v", err)
	}

	routes := GetRouteDefinitions()
	if len(routes) != 1 {
		t.Fatalf("len(GetRouteDefinitions()) = %d, want 1", len(routes))
	}
	request := httptest.NewRequest("GET", "/frontend/extension_tools/register.js", nil)
	response := httptest.NewRecorder()
	routes[0].HandlerFunc(response, request)
	if response.Code != 200 {
		t.Fatalf("status = %d, want 200", response.Code)
	}
	if response.Body.String() != "export {};\n" {
		t.Fatalf("body = %q, want extension module", response.Body.String())
	}
	if routes[0].HandlerName != "router.handleFrontend" {
		t.Fatalf("handler = %q, want public frontend profile", routes[0].HandlerName)
	}
}

func TestRegisterFrontendDirectoryRejectsAmbiguousOrMissingMounts(t *testing.T) {
	for _, prefix := range []string{
		"/frontend/",
		"/frontend/extension_tools",
		"/frontend/extension_tools/../admin/",
		"/apps/extension_tools/",
	} {
		if err := RegisterFrontendDirectory(prefix, t.TempDir()); err == nil {
			t.Fatalf("RegisterFrontendDirectory(%q) error = nil, want validation error", prefix)
		}
	}

	if err := RegisterFrontendDirectory(
		"/frontend/extension_tools/",
		filepath.Join(t.TempDir(), "missing"),
	); err == nil {
		t.Fatal("RegisterFrontendDirectory() error = nil, want missing-directory error")
	}
}
