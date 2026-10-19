// article_presentation_routes_test.go
// Protects independent article route identities without startup reader grants.
// Connects the canonical registry and the one-time migration's audience boundary.
// Prevents later route maintenance from reviving revoked users/guests access.
package router

import "testing"

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
