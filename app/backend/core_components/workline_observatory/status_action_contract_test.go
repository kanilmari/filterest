// status_action_contract_test.go
// Verifies bounded, deterministic, optimistic workline status-action requests.
// Bridges UI multi-selection with the atomic backend mutation contract.
// Exists so stale or ambiguous bulk actions cannot silently become partial updates.
package workline_observatory

import "testing"

func TestNormalizeWorklineStatusActionSortsSelectionAndAcceptsLifecycleStates(t *testing.T) {
	for _, status := range []string{"active", "paused", "closed", "archived"} {
		input, err := normalizeWorklineStatusAction(worklineStatusActionRequest{
			TargetStatus: " " + status + " ",
			Worklines: []worklineStatusActionSelection{
				{ID: 9, ExpectedRevision: 3},
				{ID: 2, ExpectedRevision: 0},
			},
		})
		if err != nil {
			t.Fatalf("%s action rejected: %v", status, err)
		}
		if input.TargetStatus != status || input.Worklines[0].ID != 2 || input.Worklines[1].ID != 9 {
			t.Fatalf("normalized %s action = %#v", status, input)
		}
	}
}

func TestNormalizeWorklineStatusActionRejectsUnsafeSelections(t *testing.T) {
	tests := []struct {
		name  string
		input worklineStatusActionRequest
		want  string
	}{
		{name: "empty", input: worklineStatusActionRequest{TargetStatus: "active"}, want: "workline_selection_must_contain_1_to_100_rows"},
		{name: "invalid status", input: worklineStatusActionRequest{TargetStatus: "done", Worklines: []worklineStatusActionSelection{{ID: 1}}}, want: "invalid_target_status"},
		{name: "invalid id", input: worklineStatusActionRequest{TargetStatus: "paused", Worklines: []worklineStatusActionSelection{{ID: 0}}}, want: "invalid_workline_selection"},
		{name: "stale shape", input: worklineStatusActionRequest{TargetStatus: "closed", Worklines: []worklineStatusActionSelection{{ID: 1, ExpectedRevision: -1}}}, want: "invalid_workline_selection"},
		{name: "duplicate", input: worklineStatusActionRequest{TargetStatus: "archived", Worklines: []worklineStatusActionSelection{{ID: 1}, {ID: 1}}}, want: "duplicate_workline_selection"},
	}
	for _, item := range tests {
		t.Run(item.name, func(t *testing.T) {
			_, err := normalizeWorklineStatusAction(item.input)
			if err == nil || err.Error() != item.want {
				t.Fatalf("error = %v, want %s", err, item.want)
			}
		})
	}
}
