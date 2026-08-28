// business_id_saver_test.go
// Verifies startup normalization of public Filterest business ID text.
// Bridges EnsureFilterestBusinessID and the shared startup SQL mock driver.
// Exists to keep legacy privacy notice maintenance covered without a live DB.
package startup

import (
	"strings"
	"testing"
)

func TestEnsureFilterestBusinessIDRunsTargetedCorrections(t *testing.T) {
	db := newAppDBCompatibilityTestDB(t)
	defer db.Close()

	pushAppDBCompatibilityExec(appDBCompatibilityExec{rowsAffected: 3})
	pushAppDBCompatibilityExec(appDBCompatibilityExec{rowsAffected: 2})
	pushAppDBCompatibilityExec(appDBCompatibilityExec{rowsAffected: 1})

	EnsureFilterestBusinessID(db)

	calls := snapshotAppDBCompatibilityCalls()
	if len(calls) != 3 {
		t.Fatalf("expected 3 business ID correction queries, got %d (%v)", len(calls), calls)
	}

	expectedFragments := []string{
		"UPDATE system_lang_keys",
		"WITH candidate AS",
		"UPDATE system_about",
	}
	for index, fragment := range expectedFragments {
		if !strings.Contains(calls[index], fragment) {
			t.Fatalf("call %d missing %q: %s", index, fragment, calls[index])
		}
		if !strings.Contains(calls[index], "regexp_replace") {
			t.Fatalf("call %d does not normalize via regexp_replace: %s", index, calls[index])
		}
	}
}
