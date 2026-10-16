// dataset_default_view_registration_test.go
// Pins the default-view route's methods, administrator profile and tableless scope.
// Connects registration to the existing administrator safety net without group migrations.
// Prevents a future refactor from exposing this metadata writer as an ordinary dataset action.
package router

import (
	"net/http"
	"testing"

	"easelect/backend/pipeline"
)

func TestDatasetDefaultViewRegistration(t *testing.T) {
	const handler = "system_table_tools.DatasetDefaultViewHandler"
	if defaultSpecificTableRelated(handler) {
		t.Fatal("default view route must use the administrator tableless safety net")
	}
	profile := pipeline.DescribeRouteProfile(handler)
	if !profile.AdminOnly || profile.ProfileName != "admin" {
		t.Fatal(profile)
	}
	manifest, err := BuildDefaultRouteManifest()
	if err != nil {
		t.Fatal(err)
	}
	for _, route := range manifest.Routes {
		if route.HandlerName != handler {
			continue
		}
		if route.PathPattern != "/api/admin/dataset-default-view" || len(route.Methods) != 3 || route.Methods[0] != http.MethodGet || route.Methods[1] != http.MethodHead || route.Methods[2] != http.MethodPost {
			t.Fatal(route)
		}
		return
	}
	t.Fatal("default view route missing")
}
