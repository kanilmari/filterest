// dataset_sort_default_profile_test.go
// Verifies distinct personal and site sorting-default security profiles.
// Bridges route metadata with authentication, CSRF, session-device, and admin checks.
// Exists so personal persistence never widens the administrator-only site scope.
package pipeline_test

import (
	"testing"

	"easelect/backend/pipeline"
)

func TestDatasetSortDefaultRoutesKeepDistinctSecurityProfiles(t *testing.T) {
	personalHandler := "system_table_tools.SavePersonalDatasetSortDefaultHandler"
	personalDescriptor := pipeline.DescribeRouteProfile(personalHandler)
	if personalDescriptor.ProfileName != "login_only" || personalDescriptor.AdminOnly {
		t.Fatalf("personal profile = %+v, want login_only", personalDescriptor)
	}
	personalStages := pipeline.DescribePipeline(
		pipeline.RouteContext{},
		pipeline.GetProfile(personalHandler),
	)
	for _, required := range []string{"auth", "csrf", "fingerprint", "device_id", "transaction"} {
		if !containsString(personalStages, required) {
			t.Fatalf("personal stages = %v, missing %q", personalStages, required)
		}
	}
	for _, forbidden := range []string{"access_control", "admin_check"} {
		if containsString(personalStages, forbidden) {
			t.Fatalf("personal stages = %v, unexpectedly contains %q", personalStages, forbidden)
		}
	}

	adminHandler := "system_table_tools.SaveDatasetSortDefaultHandler"
	adminDescriptor := pipeline.DescribeRouteProfile(adminHandler)
	if adminDescriptor.ProfileName != "admin" || !adminDescriptor.AdminOnly {
		t.Fatalf("administrator profile = %+v, want admin", adminDescriptor)
	}
}

func containsString(values []string, expected string) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}
