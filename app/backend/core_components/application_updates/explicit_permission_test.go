// explicit_permission_test.go
// Checks the permissive permission helper against the reserved update boundary.
// Connects absent rights to both ordinary routes and explicit-only update routes.
// Prevents recovery callers from treating a missing update grant as authority.
package application_updates

import (
	"easelect/backend/core_components/permissions"
	"testing"
)

func TestMissingUpdateRightCannotUsePermissivePermissionFallback(t *testing.T) {
	for _, route := range []string{"/capabilities/application-update", "/api/admin/application-update/requests", "/api/admin/application-update/jobs/{id}/decisions", "/api/unrelated"} {
		db, _ := scriptDB(t, empty("SELECT 1"))
		allowed, err := permissions.CheckRouteTablePermission(db, route, 42, permissions.RouteTableScope{}, permissions.AccessControlRouteTableOptions(true))
		if err != nil || allowed != (route == "/api/unrelated") {
			t.Fatal(route, allowed, err)
		}
	}
}
