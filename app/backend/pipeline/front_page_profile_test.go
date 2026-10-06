// front_page_profile_test.go
// Connects front page routes to the canonical browser and administrator security stages.
package pipeline_test

import (
	"easelect/backend/pipeline"
	"testing"
)

func TestFrontPageRouteSecurityProfiles(t *testing.T) {
	read := "system_table_tools.GetFrontPageHandler"
	if descriptor := pipeline.DescribeRouteProfile(read); descriptor.ProfileName != "login_only" || descriptor.AdminOnly {
		t.Fatal(descriptor)
	}
	containsAll(t, pipeline.DescribePipeline(pipeline.RouteContext{}, pipeline.GetProfile(read)), []string{"auth", "transaction"})
	for _, handler := range []string{"system_table_tools.AdminFrontPageHandler", "system_table_tools.FrontPageBackgroundHandler"} {
		if descriptor := pipeline.DescribeRouteProfile(handler); descriptor.ProfileName != "admin" || !descriptor.AdminOnly {
			t.Fatal(descriptor)
		}
		containsAll(t, pipeline.DescribePipeline(pipeline.RouteContext{}, pipeline.GetProfile(handler)), []string{"auth", "csrf", "access_control", "admin_check", "transaction"})
	}
}
