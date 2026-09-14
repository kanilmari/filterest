// priority_action_test.go
// Verifies bounded, deterministic, optimistic workline priority-action requests.
// Bridges UI multi-selection with the atomic backend mutation contract.
// Exists so stale or ambiguous bulk actions cannot silently become partial updates.
package workline_observatory

import (
	e_sessions "easelect/backend/core_components/sessions"
	"github.com/gorilla/sessions"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestNormalizeWorklinePriorityActionSortsSelectionAndAcceptsPriorities(t *testing.T) {
	for _, priority := range []string{"low", "normal", "high", "critical"} {
		input, err := normalizeWorklinePriorityAction(worklinePriorityActionRequest{
			TargetPriority: " " + priority + " ",
			Worklines: []worklinePriorityActionSelection{
				{ID: 9, ExpectedRevision: 3},
				{ID: 2, ExpectedRevision: 0},
			},
		})
		if err != nil {
			t.Fatalf("%s action rejected: %v", priority, err)
		}
		if input.TargetPriority != priority || input.Worklines[0].ID != 2 || input.Worklines[1].ID != 9 {
			t.Fatalf("normalized %s action = %#v", priority, input)
		}
	}
}

func TestNormalizeWorklinePriorityActionRejectsUnsafeSelections(t *testing.T) {
	tests := []struct {
		name  string
		input worklinePriorityActionRequest
		want  string
	}{
		{name: "empty", input: worklinePriorityActionRequest{TargetPriority: "normal"}, want: "workline_selection_must_contain_1_to_100_rows"},
		{name: "invalid priority", input: worklinePriorityActionRequest{TargetPriority: "done", Worklines: []worklinePriorityActionSelection{{ID: 1}}}, want: "invalid_target_priority"},
		{name: "invalid id", input: worklinePriorityActionRequest{TargetPriority: "normal", Worklines: []worklinePriorityActionSelection{{ID: 0}}}, want: "invalid_workline_selection"},
		{name: "stale shape", input: worklinePriorityActionRequest{TargetPriority: "normal", Worklines: []worklinePriorityActionSelection{{ID: 1, ExpectedRevision: -1}}}, want: "invalid_workline_selection"},
		{name: "duplicate", input: worklinePriorityActionRequest{TargetPriority: "normal", Worklines: []worklinePriorityActionSelection{{ID: 1}, {ID: 1}}}, want: "duplicate_workline_selection"},
	}
	for _, item := range tests {
		t.Run(item.name, func(t *testing.T) {
			_, err := normalizeWorklinePriorityAction(item.input)
			if err == nil || err.Error() != item.want {
				t.Fatalf("error = %v, want %s", err, item.want)
			}
		})
	}
}

func TestPriorityActionRejectsUnauthenticatedAndReadRequestsBeforeMutation(t *testing.T) {
	oldStore := e_sessions.Store
	e_sessions.Store = sessions.NewCookieStore([]byte("priority-actions-fixture-only-key"))
	t.Cleanup(func() { e_sessions.Store = oldStore })
	for _, method := range []string{http.MethodGet, http.MethodPost} {
		req := httptest.NewRequest(method, "/api/app/workline-observatory/priority-actions", nil)
		recorder := httptest.NewRecorder()
		WorklinePriorityActionsHandler(recorder, req)
		expected := http.StatusUnauthorized
		if method == http.MethodGet {
			expected = http.StatusMethodNotAllowed
		}
		if recorder.Code != expected {
			t.Fatalf("method %s: got %d want %d", method, recorder.Code, expected)
		}
	}
}
func TestPriorityActionRejectsOversizedSelection(t *testing.T) {
	input := worklinePriorityActionRequest{TargetPriority: "normal"}
	for i := int64(1); i <= 101; i++ {
		input.Worklines = append(input.Worklines, worklinePriorityActionSelection{ID: i})
	}
	if _, err := normalizeWorklinePriorityAction(input); err == nil {
		t.Fatal("oversized bulk selection accepted")
	}
}
