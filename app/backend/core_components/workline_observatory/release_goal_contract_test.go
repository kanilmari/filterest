// release_goal_contract_test.go
// Verifies the release-decision rules before database writes are attempted.
// Bridges handler validation with database-enforced release contract invariants.
// Exists so classification completeness and locked immutability cannot regress silently.
package workline_observatory

import "testing"

func TestValidateReleaseGoalCanLockRequiresEveryActiveWorklineClassification(t *testing.T) {
	if err := validateReleaseGoalCanLock("draft", 0); err != nil {
		t.Fatalf("complete draft goal was rejected: %v", err)
	}
	if err := validateReleaseGoalCanLock("draft", 1); err == nil || err.Error() != "active_worklines_require_release_contracts" {
		t.Fatalf("missing classification error = %v", err)
	}
	if err := validateReleaseGoalCanLock("locked", 0); err == nil || err.Error() != "release_goal_not_lockable" {
		t.Fatalf("locked goal error = %v", err)
	}
}

func TestValidateReleaseContractGoalStateKeepsLockedContractImmutable(t *testing.T) {
	if err := validateReleaseContractGoalState("draft"); err != nil {
		t.Fatalf("draft contract was rejected: %v", err)
	}
	if err := validateReleaseContractGoalState("locked"); err == nil || err.Error() != "locked_release_goal_contracts_are_immutable" {
		t.Fatalf("locked contract error = %v", err)
	}
}
