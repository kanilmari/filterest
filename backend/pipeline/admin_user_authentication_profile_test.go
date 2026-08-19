// admin_user_authentication_profile_test.go
// Verifies the administrator-only pipeline profile for user authentication provisioning.
// Bridges the route profile registry and the effective security middleware stages.
// Exists to prevent this credential-adjacent route from losing auth, CSRF, or admin checks.
package pipeline_test

import (
	"testing"

	"easelect/backend/pipeline"
)

func TestAdminUserAuthenticationRouteUsesAdminSecurityPipeline(t *testing.T) {
	handlerName := "auth.AdminUserAuthenticationHandler"
	descriptor := pipeline.DescribeRouteProfile(handlerName)
	if descriptor.ProfileName != "admin" || !descriptor.AdminOnly {
		t.Fatalf("profile = %+v, want AdminProfile", descriptor)
	}

	stages := pipeline.DescribePipeline(pipeline.RouteContext{}, pipeline.GetProfile(handlerName))
	containsAll(t, stages, []string{"auth", "csrf", "access_control", "admin_check", "transaction"})
}
