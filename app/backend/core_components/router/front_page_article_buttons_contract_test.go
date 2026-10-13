// front_page_article_buttons_contract_test.go
// Holds the administrator article-list API to runtime route and method contracts.
// Connects registration, generated manifest and the shared administrator pipeline.
// Prevents a public route, wildcard address or unsupported write method.
package router_test

import (
	"net/http/httptest"
	"reflect"
	"testing"

	"easelect/backend/core_components/router"
)

func TestFrontPageArticleButtonsRouteContract(t *testing.T) {
	t.Setenv("ENVIRONMENT_TYPE", "production")
	manifest, err := router.BuildDefaultRouteManifest()
	if err != nil {
		t.Fatal(err)
	}
	const handler = "system_table_tools.AdminFrontPageArticleButtonsHandler"
	found := false
	for _, route := range manifest.Routes {
		if route.HandlerName != handler {
			continue
		}
		found = true
		if route.PathPattern != "/api/admin/front-page/article-buttons" || route.MatchType != router.RouteMatchExact || !reflect.DeepEqual(route.Methods, []string{"GET", "HEAD", "POST"}) {
			t.Fatal(route)
		}
		for _, scenario := range route.Scenarios {
			if scenario.ProfileName != "admin" || !scenario.AdminOnly {
				t.Fatal(scenario)
			}
		}
	}
	if !found {
		t.Fatal("article-list route absent from manifest")
	}
	router.RegisterRoutes("frontend", "storage")
	for _, route := range router.GetRouteDefinitions() {
		if route.HandlerName == handler {
			response := httptest.NewRecorder()
			route.HandlerFunc(response, httptest.NewRequest("DELETE", route.UrlPattern, nil))
			if response.Code != 405 {
				t.Fatal("unsupported method reached handler", response.Code)
			}
			return
		}
	}
	t.Fatal("article-list route not registered")
}
