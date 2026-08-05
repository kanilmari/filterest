// browse_permission_consistency_test.go
// Verifies the startup guard that heals the anonymous-browse / guest-rights mismatch.
// Bridges EnsureAnonymousBrowseConsistency and the shared startup SQL mock driver.
// Exists to keep the 403-storm bootstrap regression covered without a live DB.
package startup

import (
	"database/sql/driver"
	"strings"
	"testing"
)

// Inconsistent bootstrap: anonymous browsing on, guest cannot read datasets ->
// the guard must force login_to_browse=true via an upsert.
func TestEnsureAnonymousBrowseConsistencyHealsInconsistentBootstrap(t *testing.T) {
	db := newAppDBCompatibilityTestDB(t)
	defer db.Close()

	pushAppDBCompatibilityQuery(appDBCompatibilityQuery{columns: []string{"boolean_value"}, rows: [][]driver.Value{{false}}})
	pushAppDBCompatibilityQuery(appDBCompatibilityQuery{columns: []string{"exists"}, rows: [][]driver.Value{{false}}})
	pushAppDBCompatibilityExec(appDBCompatibilityExec{rowsAffected: 1})

	EnsureAnonymousBrowseConsistency(db)

	calls := snapshotAppDBCompatibilityCalls()
	if len(calls) != 3 {
		t.Fatalf("expected read, probe and heal (3 calls), got %d (%v)", len(calls), calls)
	}
	if !strings.Contains(calls[2], "INSERT INTO system_config") || !strings.Contains(calls[2], "login_to_browse") {
		t.Fatalf("heal query did not upsert login_to_browse: %s", calls[2])
	}
	if !strings.Contains(calls[2], "boolean_value = TRUE") {
		t.Fatalf("heal query did not set login required: %s", calls[2])
	}
}

// Login already required: the guard must short-circuit after the first read and
// never touch permissions or config.
func TestEnsureAnonymousBrowseConsistencySkipsWhenLoginRequired(t *testing.T) {
	db := newAppDBCompatibilityTestDB(t)
	defer db.Close()

	pushAppDBCompatibilityQuery(appDBCompatibilityQuery{columns: []string{"boolean_value"}, rows: [][]driver.Value{{true}}})

	EnsureAnonymousBrowseConsistency(db)

	calls := snapshotAppDBCompatibilityCalls()
	if len(calls) != 1 {
		t.Fatalf("expected only the login_to_browse read, got %d (%v)", len(calls), calls)
	}
}

// Public-browse instance: anonymous browsing on and the guest already has read
// rights -> genuinely configured, so the guard must not heal.
func TestEnsureAnonymousBrowseConsistencySkipsConfiguredPublicBrowse(t *testing.T) {
	db := newAppDBCompatibilityTestDB(t)
	defer db.Close()

	pushAppDBCompatibilityQuery(appDBCompatibilityQuery{columns: []string{"boolean_value"}, rows: [][]driver.Value{{false}}})
	pushAppDBCompatibilityQuery(appDBCompatibilityQuery{columns: []string{"exists"}, rows: [][]driver.Value{{true}}})

	EnsureAnonymousBrowseConsistency(db)

	calls := snapshotAppDBCompatibilityCalls()
	if len(calls) != 2 {
		t.Fatalf("expected read and probe only (no heal), got %d (%v)", len(calls), calls)
	}
	for _, call := range calls {
		if strings.Contains(call, "INSERT INTO system_config") {
			t.Fatalf("guard healed a correctly-configured public-browse instance: %s", call)
		}
	}
}
