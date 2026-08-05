// view_selector_lang_keys_test.go
// Verifies startup-owned view-selector lang keys overwrite legacy wording.
// Bridges EnsureViewSelectorLangKeys and the startup SQL mock driver used in this package.
// Exists to keep generic view button labels short across existing development DBs.
package startup

import (
	"strings"
	"testing"
)

func TestEnsureViewSelectorLangKeysOverwritesLegacyLabels(t *testing.T) {
	db := newAppDBCompatibilityTestDB(t)
	defer db.Close()

	for range viewSelectorLangKeySeeds {
		pushAppDBCompatibilityExec(appDBCompatibilityExec{rowsAffected: 1})
	}

	EnsureViewSelectorLangKeys(db)

	calls := snapshotAppDBCompatibilityCalls()
	if len(calls) != len(viewSelectorLangKeySeeds) {
		t.Fatalf("expected %d view-selector lang-key calls, got %d (%v)", len(viewSelectorLangKeySeeds), len(calls), calls)
	}
	for _, call := range calls {
		if !strings.Contains(call, "INSERT INTO system_lang_keys") {
			t.Fatalf("expected system_lang_keys upsert, got %q", call)
		}
		if !strings.Contains(call, "ON CONFLICT (lang_key) DO UPDATE") {
			t.Fatalf("expected lang_key overwrite on conflict, got %q", call)
		}
		if strings.Contains(call, "CASE WHEN system_lang_keys.fi") {
			t.Fatalf("expected overwrite seed, not fill-empty-only seed: %q", call)
		}
	}
}
