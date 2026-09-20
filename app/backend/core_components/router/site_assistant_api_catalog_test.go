// site_assistant_api_catalog_test.go
// Verifies the site assistant API catalog, its embedded handler docs and core operation examples.
// Bridges the live route registry, the generated docs file and the admin-only catalog route.
// Exists so the assistant's API description cannot silently drift from the running code.
package router_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"easelect/backend/core_components/router"
	"easelect/backend/pipeline"
)

func backendRootForTest(t *testing.T) string {
	t.Helper()
	_, currentFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("resolve test file path")
	}
	return filepath.Clean(filepath.Join(filepath.Dir(currentFile), "..", ".."))
}

func TestEmbeddedRouteHandlerDocsMatchSourceComments(t *testing.T) {
	manifest, err := router.BuildDefaultRouteManifest()
	if err != nil {
		t.Fatalf("BuildDefaultRouteManifest: %v", err)
	}
	names := make([]string, 0, len(manifest.Routes))
	for _, route := range manifest.Routes {
		names = append(names, route.HandlerName)
	}
	fresh, err := router.ExtractRouteHandlerDocs(backendRootForTest(t), names)
	if err != nil {
		t.Fatalf("ExtractRouteHandlerDocs: %v", err)
	}
	embedded, err := router.EmbeddedRouteHandlerDocs()
	if err != nil {
		t.Fatalf("EmbeddedRouteHandlerDocs: %v", err)
	}
	for name, doc := range fresh {
		if got, ok := embedded[name]; !ok || got != doc {
			t.Fatalf("route handler docs are stale for %s; run go run ./server_tools/scripts/generate_route_manifest.go", name)
		}
	}
	if len(embedded) != len(fresh) {
		t.Fatalf("embedded docs cover %d handlers, registry has %d; regenerate route data", len(embedded), len(fresh))
	}
}

func TestSiteAssistantCatalogDescribesLiveRoutesAndValidCoreOperations(t *testing.T) {
	t.Setenv("ENVIRONMENT_TYPE", "production")
	t.Setenv("ENABLE_API_LANGUAGE", "")
	pipeline.ResetRouteProfiles()
	router.RegisterRoutes("frontend", "storage")
	defer router.ResetRouteDefinitions()

	catalog, err := router.BuildSiteAssistantAPICatalog()
	if err != nil {
		t.Fatalf("BuildSiteAssistantAPICatalog: %v", err)
	}

	byPath := map[string]router.SiteAssistantCatalogRoute{}
	for _, route := range catalog.Routes {
		if !strings.HasPrefix(route.Path, "/api/") && route.Path != "/storage/" {
			t.Fatalf("catalog must list API routes only, got %s", route.Path)
		}
		byPath[route.Path] = route
	}

	self, ok := byPath["/api/admin/site-assistant/api-catalog"]
	if !ok || self.Access != "admin" || !self.AdminOnly || strings.Join(self.Methods, ",") != http.MethodGet+","+http.MethodHead {
		t.Fatalf("catalog route must be admin-only GET, got %+v", self)
	}
	if self.Summary == "" {
		t.Fatal("catalog route summary should come from its doc comment")
	}

	for _, operation := range catalog.CoreOperations {
		if _, ok := byPath[operation.Path]; !ok {
			t.Fatalf("core operation %s points to unregistered route %s", operation.Name, operation.Path)
		}
	}

	markdown := router.RenderSiteAssistantAPICatalogMarkdown(catalog)
	for _, expected := range []string{"## Core operations", "update_row: POST /api/update-row", "/api/admin/site-assistant/api-catalog [admin; GET,HEAD]"} {
		if !strings.Contains(markdown, expected) {
			t.Fatalf("markdown catalog is missing %q", expected)
		}
	}
}

func TestSiteAssistantCatalogHandlerFormats(t *testing.T) {
	t.Setenv("ENVIRONMENT_TYPE", "production")
	pipeline.ResetRouteProfiles()
	router.RegisterRoutes("frontend", "storage")
	defer router.ResetRouteDefinitions()

	handler := findRouteHandler(t, "router.siteAssistantAPICatalogHandler")

	jsonRecorder := httptest.NewRecorder()
	handler(jsonRecorder, httptest.NewRequest(http.MethodGet, "/api/admin/site-assistant/api-catalog", nil))
	var decoded router.SiteAssistantAPICatalog
	if jsonRecorder.Code != http.StatusOK || json.Unmarshal(jsonRecorder.Body.Bytes(), &decoded) != nil || len(decoded.Routes) == 0 {
		t.Fatalf("JSON catalog = %d %s", jsonRecorder.Code, jsonRecorder.Body.String())
	}

	markdownRecorder := httptest.NewRecorder()
	handler(markdownRecorder, httptest.NewRequest(http.MethodGet, "/api/admin/site-assistant/api-catalog?format=markdown", nil))
	if markdownRecorder.Code != http.StatusOK || !strings.HasPrefix(markdownRecorder.Header().Get("Content-Type"), "text/markdown") {
		t.Fatalf("markdown catalog = %d %q", markdownRecorder.Code, markdownRecorder.Header().Get("Content-Type"))
	}

	postRecorder := httptest.NewRecorder()
	handler(postRecorder, httptest.NewRequest(http.MethodPost, "/api/admin/site-assistant/api-catalog", nil))
	if postRecorder.Code != http.StatusMethodNotAllowed {
		t.Fatalf("POST catalog = %d, want 405", postRecorder.Code)
	}
}

func findRouteHandler(t *testing.T, handlerName string) http.HandlerFunc {
	t.Helper()
	for _, definition := range router.GetRouteDefinitions() {
		if definition.HandlerName == handlerName {
			return definition.HandlerFunc
		}
	}
	t.Fatalf("handler %s is not registered", handlerName)
	return nil
}
