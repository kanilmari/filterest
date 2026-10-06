// favorites_method_contract_test.go
// Checks unsupported favorites methods against the actual route registration.
// Bridges the public router declaration and its method-enforcing wrapper.
// Exists so favorites rely on the router rather than a second handler-local guard.
package router_test

import (
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"

	"easelect/backend/core_components/router"
)

func TestFavoritesRegisteredRouteRejectsUnsupportedMethods(t *testing.T) {
	router.RegisterRoutes(t.TempDir(), t.TempDir())
	t.Cleanup(router.ResetRouteDefinitions)
	for _, route := range router.GetRouteDefinitions() {
		if route.HandlerName != "favorites.FavoritesHandler" {
			continue
		}
		if route.UrlPattern != "/api/favorites" || !slices.Equal(route.Methods, []string{"GET", "HEAD", "POST", "DELETE"}) {
			t.Fatalf("favorites route contract = %#v", route)
		}
		for _, method := range []string{http.MethodPut, http.MethodPatch, http.MethodOptions, http.MethodTrace, http.MethodConnect} {
			t.Run(method, func(t *testing.T) {
				response := httptest.NewRecorder()
				request := httptest.NewRequest(method, route.UrlPattern, strings.NewReader(`{"type":"admin_tool","route":"/tool"}`))
				route.HandlerFunc(response, request)
				if response.Code != http.StatusMethodNotAllowed || response.Header().Get("Allow") != "GET, HEAD, POST, DELETE" {
					t.Fatalf("status = %d, Allow = %q", response.Code, response.Header().Get("Allow"))
				}
			})
		}
		return
	}
	t.Fatal("favorites route is not registered")
}
