// application_update_recovery_test.go
// Exercises the administrator recovery fallback against update capability routes.
// Connects development recovery mode to the canonical route authorization helper.
// Explicit update authority remains mandatory even when other missing rights recover.
package access_control

import "testing"

func TestApplicationUpdateNeverUsesAdministratorRecoveryFallback(t *testing.T) {
	t.Setenv("ENVIRONMENT_TYPE", "dev")
	t.Setenv("FILTEREST_ADMIN_PERMISSION_RECOVERY_MODE", "true")
	setupMockDB(t, acMockConfig{specificRelated: false, permissionGranted: false, isAdmin: true})
	for _, route := range []string{"/capabilities/application-update", "/api/admin/application-update/requests", "/api/admin/application-update/jobs/{id}/decisions"} {
		allowed, recovery, _, _, err := routeTablePermissionDecision(42, route, "", "")
		if err != nil || allowed || recovery {
			t.Fatal(route, allowed, recovery, err)
		}
	}
}
