// component_assets_handler_test.go
// Verifies component route registration, methods and an absent component tree.
// Connects the normal route registry to its explicit public security profile.
// Keeps the empty component contract compatible with older runtime images.
package router

import (
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"easelect/backend/pipeline"
)

func TestComponentsRouteMethodsAndPublicProfile(t *testing.T) {
	root := t.TempDir()
	frontend := filepath.Join(root, "frontend")
	component := filepath.Join(root, "components", "sample", "frontend")
	if err := os.MkdirAll(component, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(component, "module.js"), []byte("export {};"), 0600); err != nil {
		t.Fatal(err)
	}
	previous := localFrontendDir
	t.Cleanup(func() { localFrontendDir = previous; ResetRouteDefinitions() })
	RegisterRoutes(frontend, "storage")
	var route *RouteDefinition
	for _, candidate := range GetRouteDefinitions() {
		if candidate.UrlPattern == "/components/" {
			value := candidate
			route = &value
		}
	}
	if route == nil || !reflect.DeepEqual(route.Methods, []string{"GET", "HEAD"}) {
		t.Fatalf("component route = %#v", route)
	}
	if profile, exists := pipeline.RouteProfiles[route.HandlerName]; !exists || !reflect.DeepEqual(profile, pipeline.PublicProfile) {
		t.Fatal("missing explicit PublicProfile")
	}
	for method, status := range map[string]int{"GET": 200, "HEAD": 200, "POST": 405, "PUT": 405, "DELETE": 405} {
		response := httptest.NewRecorder()
		route.HandlerFunc(response, httptest.NewRequest(method, "/components/sample/frontend/module.js", nil))
		if response.Code != status {
			t.Errorf("%s = %d, want %d", method, response.Code, status)
		}
		if status == 405 && response.Header().Get("Allow") != "GET, HEAD" {
			t.Errorf("%s Allow = %q", method, response.Header().Get("Allow"))
		}
	}
}

func TestComponentsRouteMissingTreeCreatesNothing(t *testing.T) {
	previous := localFrontendDir
	root := t.TempDir()
	localFrontendDir = filepath.Join(root, "frontend")
	t.Cleanup(func() { localFrontendDir = previous })
	response := httptest.NewRecorder()
	handleComponents(response, httptest.NewRequest("GET", "/components/sample/frontend/module.js", nil))
	if response.Code != 404 {
		t.Fatalf("missing tree = %d", response.Code)
	}
	if _, err := os.Lstat(filepath.Join(root, "components")); !os.IsNotExist(err) {
		t.Fatalf("request created components: %v", err)
	}
}
