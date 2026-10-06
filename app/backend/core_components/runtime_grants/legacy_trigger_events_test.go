// legacy_trigger_events_test.go
// Proves attachment events and UPDATE OF columns limit recursive requirements.
// Uses pure dependency reachability, including narrow auxiliary writes.
// Insert permission cannot activate an update-only attachment.
package runtime_grants

import "testing"

func TestLegacyTriggerReachabilityUsesEventsAndUpdateColumns(t *testing.T) {
	dep := Dependency{When: Update, SourceUpdateColumns: []string{"title"}}
	for _, tc := range []struct {
		operation Operation
		columns   map[string]bool
		want      bool
	}{
		{Insert, map[string]bool{"": true}, false}, {Delete, nil, false},
		{Update, map[string]bool{"updated": true}, false}, {Update, map[string]bool{"title": true}, true},
		{Update, map[string]bool{"": true}, true},
	} {
		if got := legacyTriggerReachable(dep, tc.operation, tc.columns); got != tc.want {
			t.Fatal(tc, got)
		}
	}
	dep.When = 0
	if legacyTriggerReachable(dep, Insert|Update|Delete, map[string]bool{"": true}) {
		t.Fatal("eventless attachment grants")
	}
}
