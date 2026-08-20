// admin_lang_key_profile_test.go
// Verifies the production language-key endpoint uses every administrator security stage.
// Bridges route-profile metadata with authentication, CSRF, permission, admin, and transaction middleware.
// Exists to prevent translation writes from bypassing the protected admin pipeline.
package pipeline_test

import (
	"testing"

	"easelect/backend/pipeline"
)

func TestAdminLangKeyRouteUsesAdminSecurityPipeline(t *testing.T) {
	handlerName := "lang.AdminLangKeyHandler"
	descriptor := pipeline.DescribeRouteProfile(handlerName)
	if descriptor.ProfileName != "admin" || !descriptor.AdminOnly {
		t.Fatalf("profile = %+v, want AdminProfile", descriptor)
	}

	stages := pipeline.DescribePipeline(pipeline.RouteContext{}, pipeline.GetProfile(handlerName))
	containsAll(t, stages, []string{"auth", "csrf", "access_control", "admin_check", "transaction"})
}
