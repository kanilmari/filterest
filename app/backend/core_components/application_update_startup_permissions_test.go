// application_update_startup_permissions_test.go
// Verifies startup grant queries exclude the separately granted update capability.
// Connects the existing permission safety nets to the explicit-only admission rule.
// Keeps both tableless and dataset grant backfills from authorizing application updates.
package backend

import (
	"strings"
	"testing"
)

func TestApplicationUpdateCapabilityExcludedFromStartupGrants(t *testing.T) {
	db := newPermissionExecTestDB(t)
	defer db.Close()
	pushPermissionExec(queuedPermissionExec{})
	pushPermissionExec(queuedPermissionExec{})
	if err := EnsureAdminPermissions(db); err != nil {
		t.Fatal(err)
	}
	if err := EnsureAdminTablePermissions(db); err != nil {
		t.Fatal(err)
	}
	calls := snapshotPermissionExecCalls()
	if len(calls) != 2 || !strings.Contains(calls[0], "sf.name <> $2") || !strings.Contains(calls[1], "sf.name <> $2") {
		t.Fatal(calls)
	}
}
