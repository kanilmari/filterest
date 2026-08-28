// task_todo_progress_handler_test.go
// Tests todo progress math used by the task article status visual.
// Bridges status-count inputs and progress payload values without requiring a database.
// Exists so percent rounding and ten-light segment behavior stay stable.
package system_table_tools

import "testing"

func TestSummarizeTaskTodoProgress(t *testing.T) {
	statuses := []taskTodoStatusCount{
		{Slug: "todo", Count: 82, IsCompletionStatus: false},
		{Slug: "done", Count: 48, IsCompletionStatus: true},
	}

	total, completed, percent, litSegments := summarizeTaskTodoProgress(statuses)

	if total != 130 {
		t.Fatalf("total = %d, want 130", total)
	}
	if completed != 48 {
		t.Fatalf("completed = %d, want 48", completed)
	}
	if percent != 37 {
		t.Fatalf("percent = %d, want 37", percent)
	}
	if litSegments != 3 {
		t.Fatalf("litSegments = %d, want 3", litSegments)
	}
}

func TestSummarizeTaskTodoProgressFullCompletionLightsAllSegments(t *testing.T) {
	statuses := []taskTodoStatusCount{
		{Slug: "done", Count: 3, IsCompletionStatus: true},
	}

	total, completed, percent, litSegments := summarizeTaskTodoProgress(statuses)

	if total != 3 || completed != 3 {
		t.Fatalf("summary = total %d completed %d, want 3/3", total, completed)
	}
	if percent != 100 {
		t.Fatalf("percent = %d, want 100", percent)
	}
	if litSegments != 10 {
		t.Fatalf("litSegments = %d, want 10", litSegments)
	}
}
