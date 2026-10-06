// favorites_profile_test.go
// Keeps personal tool favorites behind the full administrator pipeline.
// Connects the handler profile with auth, CSRF, permissions and request transactions.
package pipeline_test

import (
	"easelect/backend/pipeline"
	"testing"
)

func TestFavoritesUsesAdminSecurityPipeline(t *testing.T) {
	const handler = "favorites.FavoritesHandler"
	descriptor := pipeline.DescribeRouteProfile(handler)
	if descriptor.ProfileName != "admin" || !descriptor.AdminOnly {
		t.Fatal(descriptor)
	}
	containsAll(t, pipeline.DescribePipeline(pipeline.RouteContext{}, pipeline.GetProfile(handler)),
		[]string{"auth", "csrf", "access_control", "admin_check", "transaction"})
}
