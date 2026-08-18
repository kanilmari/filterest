// agent_task_todos_test.go
// Verifies ticket todo helper behavior without touching a live database.
// Bridges agent-tools todo API contracts and stable SQL builder expectations.
// Exists so independent todo completion cannot regress into task-status mutation.

package agent_tools

import (
	"reflect"
	"testing"
)

func TestValidateTaskTodoStatus(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{name: "empty defaults to todo", in: "", want: "todo"},
		{name: "todo stays todo", in: "todo", want: "todo"},
		{name: "partially done stays partially done", in: "partially_done", want: "partially_done"},
		{name: "needs review stays needs review", in: "needs_review", want: "needs_review"},
		{name: "not applicable stays not applicable", in: "not_applicable", want: "not_applicable"},
		{name: "done stays done", in: "done", want: "done"},
		{name: "case and spaces normalize", in: " Done ", want: "done"},
		{name: "blocked is rejected for first slice", in: "blocked", want: ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := validateTaskTodoStatus(tt.in); got != tt.want {
				t.Fatalf("validateTaskTodoStatus(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}

func TestValidateTaskTodoText(t *testing.T) {
	if got := validateTaskTodoText("  Add API route  "); got != "Add API route" {
		t.Fatalf("validateTaskTodoText trimmed value = %q", got)
	}
	if got := validateTaskTodoText("   "); got != "" {
		t.Fatalf("blank todo text should be rejected, got %q", got)
	}
}

func TestBuildTaskTodoUpdateQueryMarksDoneWithoutTaskStatus(t *testing.T) {
	status := "done"
	patch := agentTaskTodoPatch{ID: 77, Status: &status}

	query, args, err := buildTaskTodoUpdateQuery(patch, 12)
	if err != nil {
		t.Fatalf("buildTaskTodoUpdateQuery returned unexpected error: %v", err)
	}

	wantQuery := "UPDATE dev_agent_task_todos SET status = $1, completed = NOW(), completed_by = $2 WHERE id = $3 RETURNING updated"
	if query != wantQuery {
		t.Fatalf("query = %q, want %q", query, wantQuery)
	}

	wantArgs := []interface{}{"done", 12, int64(77)}
	if !reflect.DeepEqual(args, wantArgs) {
		t.Fatalf("args = %#v, want %#v", args, wantArgs)
	}
}

func TestBuildTaskTodoUpdateQueryReopensTodo(t *testing.T) {
	status := "todo"
	patch := agentTaskTodoPatch{ID: 77, Status: &status}

	query, args, err := buildTaskTodoUpdateQuery(patch, 12)
	if err != nil {
		t.Fatalf("buildTaskTodoUpdateQuery returned unexpected error: %v", err)
	}

	wantQuery := "UPDATE dev_agent_task_todos SET status = $1, completed = NULL, completed_by = NULL WHERE id = $2 RETURNING updated"
	if query != wantQuery {
		t.Fatalf("query = %q, want %q", query, wantQuery)
	}

	wantArgs := []interface{}{"todo", int64(77)}
	if !reflect.DeepEqual(args, wantArgs) {
		t.Fatalf("args = %#v, want %#v", args, wantArgs)
	}
}

func TestBuildTaskTodoUpdateQueryPartialClearsCompletionFields(t *testing.T) {
	status := "partially_done"
	patch := agentTaskTodoPatch{ID: 77, Status: &status}

	query, args, err := buildTaskTodoUpdateQuery(patch, 12)
	if err != nil {
		t.Fatalf("buildTaskTodoUpdateQuery returned unexpected error: %v", err)
	}

	wantQuery := "UPDATE dev_agent_task_todos SET status = $1, completed = NULL, completed_by = NULL WHERE id = $2 RETURNING updated"
	if query != wantQuery {
		t.Fatalf("query = %q, want %q", query, wantQuery)
	}

	wantArgs := []interface{}{"partially_done", int64(77)}
	if !reflect.DeepEqual(args, wantArgs) {
		t.Fatalf("args = %#v, want %#v", args, wantArgs)
	}
}

func TestBuildTaskTodoUpdateQueryUpdatesTextAndSortOrder(t *testing.T) {
	text := "Refine component tree"
	sortOrder := 30
	patch := agentTaskTodoPatch{ID: 77, TodoText: &text, SortOrder: &sortOrder}

	query, args, err := buildTaskTodoUpdateQuery(patch, 12)
	if err != nil {
		t.Fatalf("buildTaskTodoUpdateQuery returned unexpected error: %v", err)
	}

	wantQuery := "UPDATE dev_agent_task_todos SET todo_text = $1, sort_order = $2 WHERE id = $3 RETURNING updated"
	if query != wantQuery {
		t.Fatalf("query = %q, want %q", query, wantQuery)
	}

	wantArgs := []interface{}{"Refine component tree", 30, int64(77)}
	if !reflect.DeepEqual(args, wantArgs) {
		t.Fatalf("args = %#v, want %#v", args, wantArgs)
	}
}

func TestBuildTaskTodoUpdateQueryRejectsEmptyPatch(t *testing.T) {
	_, _, err := buildTaskTodoUpdateQuery(agentTaskTodoPatch{ID: 77}, 12)
	if err == nil || err.Error() != "no fields to update" {
		t.Fatalf("expected no fields error, got %v", err)
	}
}
