// new_mutation_blockers_test.go
// Proves newly invalid identities are refused even without any resolved scope.
// Compares pure before/after snapshots, including unchanged unrelated blockers.
// Diagnostic changes do not turn an old blocker into a new object.
package runtime_grants

import "testing"

func TestNewMutationBlockersUseMetadataIdentity(t *testing.T) {
	before := policyFixture()
	old := Finding{Finding: "blocker", Kind: "table", ObjectOID: 91, Object: `"public"."system_triggers"`, Reason: "row id 7: missing source"}
	before.Blockers = []Finding{old}
	after := before
	after.Blockers = []Finding{old}
	after.Blockers[0].Reason = "row id 7: missing both endpoints"
	if found, err := NewMutationBlockers(before, after); err != nil || len(found) != 0 {
		t.Fatal(found, err)
	}
	for _, reason := range []string{"missing source", "missing target", "missing both endpoints"} {
		fresh := old
		fresh.Reason = "row id 8: " + reason
		after.Blockers = append([]Finding{old}, fresh)
		found, err := NewMutationBlockers(before, after)
		if err != nil || len(found) != 1 || found[0] != fresh {
			t.Fatal(found, err)
		}
	}
	old.Kind = "trigger"
	old.ObjectOID = 123
	old.Object = "old name"
	old.Reason = "unreviewed body"
	before.Blockers = []Finding{old}
	after.Blockers = []Finding{old}
	after.Blockers[0].Object = "renamed source"
	if found, err := NewMutationBlockers(before, after); err != nil || len(found) != 0 {
		t.Fatal(found, err)
	}
}
