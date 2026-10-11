// automatic_refresh_baseline_test.go
// Reproduces the held-lock proof's original maintenance refusal without PostgreSQL.
// Uses the production scope computation with the two absent bootstrap relations.
// Keeps the corrected fixture from weakening blocker locality to obtain HTTP 200.
package runtime_grants

import (
	"errors"
	"fmt"
	"testing"
)

func TestAutomaticRefreshSetupPreservesAffectedBlockerRefusal(t *testing.T) {
	before, after := policyFixture(), policyFixture()
	for _, missing := range []struct {
		uid  int64
		name string
	}{{209, "spatial_ref_sys"}, {216, "payments"}} {
		before.Blockers = append(before.Blockers, Finding{
			Role: "policy", Kind: "table", Object: `"public"."system_db_tables"`, Finding: "blocker",
			Reason: fmt.Sprintf(`row id %d: missing snapshot identity table_uid=%d ("public"."%s")`, missing.uid, missing.uid, missing.name),
		})
	}
	// Explicit maintenance removes the dangling rows. The generic mutation
	// therefore reaches their old scope identities and must still refuse.
	scope := ChangedDatasetOIDs(before, after)
	_, _, err := reconciliationChecks(after, &before, scope)
	var blocked *ScopeBlocker
	if !errors.As(err, &blocked) || len(blocked.Findings) != 2 {
		t.Fatalf("maintenance unexpectedly accepted affected legacy blockers: scope=%v err=%v", scope, err)
	}
	// A valid fixture, cleared before the preflight snapshot, can initialize.
	if _, _, err := reconciliationChecks(after, &after, []int64{}); err != nil {
		t.Fatal("valid automatic-refresh baseline refused", err)
	}
	t.Log("original initial maintenance: affected UIDs 209 and 216 refuse; current baseline succeeds")
}
