// dataset_appearance_profile_test.go
// Verifies the dataset appearance write route keeps the palette security boundary.
// Connects route metadata with auth, CSRF, permissions and request transactions.
// Prevents an appearance mutation from widening to readers or guests.
package pipeline_test

import (
	"easelect/backend/pipeline"
	"testing"
)

func TestDatasetAppearanceAdminProfile(t *testing.T) {
	name := "system_table_tools.AdminDatasetAppearanceHandler"
	descriptor := pipeline.DescribeRouteProfile(name)
	if !descriptor.AdminOnly || descriptor.ProfileName != "admin" {
		t.Fatalf("appearance profile: %+v", descriptor)
	}
	containsAll(t, pipeline.DescribePipeline(pipeline.RouteContext{}, pipeline.GetProfile(name)), []string{"auth", "csrf", "access_control", "admin_check", "transaction"})
}
