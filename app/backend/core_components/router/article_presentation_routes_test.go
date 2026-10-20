// article_presentation_routes_test.go
// Protects independent article route identities without startup reader grants.
// Connects the canonical registry and the one-time migration's audience boundary.
// Prevents later route maintenance from reviving revoked users/guests access.
package router

import (
	"easelect/backend/pipeline"
	"reflect"
	"testing"
)

func TestArticlePresentationRoutesHaveNoStartupReaderGrants(t *testing.T) {
	for _, key := range []string{"image_first_view", "image_first_page_view"} {
		found := false
		for _, route := range canonicalUIPermissionRoutes {
			if route.Name != "ui.view."+key {
				continue
			}
			found = true
			if route.URLRouteEndpoint != "/ui/view/"+key || route.DefaultGrantGroups != "" {
				t.Fatalf("independent audience contract: %#v", route)
			}
		}
		if !found {
			t.Fatal("missing route", key)
		}
	}
}

func TestArticlePresentationsAtomicRouteIsAdministratorOnly(t *testing.T) {
	t.Cleanup(ResetRouteDefinitions)
	RegisterRoutes(t.TempDir(), t.TempDir())
	found := false
	for _, route := range GetRouteDefinitions() {
		if route.UrlPattern != "/api/admin/view-field-settings/article-presentations" {
			continue
		}
		found = true
		if route.HandlerName != "system_table_tools.ArticlePresentationsHandler" || !reflect.DeepEqual(route.Methods, []string{"GET", "HEAD", "POST"}) {
			t.Fatal(route)
		}
		if profile, ok := pipeline.RouteProfiles[route.HandlerName]; !ok || !reflect.DeepEqual(profile, pipeline.AdminProfile) {
			t.Fatal("administrator profile required")
		}
	}
	if !found {
		t.Fatal("missing route")
	}
}
