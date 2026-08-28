// app_db_compatibility_lang_keys_test.go
// Verifies the startup-owned app↔DB compatibility lang-key seeding path.
// Bridges EnsureAppDBCompatibilityLangKeys and the startup SQL mock driver used in this package.
// Exists to keep the admin-tree translation seed covered without requiring a live PostgreSQL instance.
package startup

import (
	"strings"
	"testing"
)

func TestEnsureAppDBCompatibilityLangKeysUpsertsMirrorDatasetKey(t *testing.T) {
	db := newAppDBCompatibilityTestDB(t)
	defer db.Close()

	pushAppDBCompatibilityExec(appDBCompatibilityExec{rowsAffected: 1})

	EnsureAppDBCompatibilityLangKeys(db)

	calls := snapshotAppDBCompatibilityCalls()
	if len(calls) != 1 {
		t.Fatalf("expected 1 startup lang-key upsert call, got %d (%v)", len(calls), calls)
	}
	if !strings.Contains(calls[0], "INSERT INTO system_lang_keys") {
		t.Fatalf("expected system_lang_keys upsert, got %q", calls[0])
	}
	if !strings.Contains(calls[0], "ON CONFLICT (lang_key)") {
		t.Fatalf("expected lang_key conflict handling, got %q", calls[0])
	}
}
