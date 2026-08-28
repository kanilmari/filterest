package agent_tools

import (
	"encoding/json"
	"reflect"
	"testing"
	"time"

	"github.com/lib/pq"
)

func strPtr(s string) *string {
	return &s
}

func TestNormalizeTaskStatusForDB(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{name: "canonical status stays unchanged", in: "on_hold", want: "on_hold"},
		{name: "aborted terminal status stays unchanged", in: "aborted", want: "aborted"},
		{name: "review alias maps to canonical human decision status", in: "awaiting_review", want: "awaiting_human_decision"},
		{name: "closed aliases to done", in: "closed", want: "done"},
		{name: "later aliases to backlog later", in: "later", want: "backlog_later"},
		{name: "nice_to_have aliases to backlog nice to have", in: "nice_to_have", want: "backlog_nice_to_have"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := normalizeTaskStatusForDB(tt.in); got != tt.want {
				t.Fatalf("normalizeTaskStatusForDB(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}

func TestNormalizeTaskStatusForClient(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{name: "legacy review alias normalizes to canonical status", in: "awaiting_review", want: "awaiting_human_decision"},
		{name: "later alias normalizes to backlog later", in: "later", want: "backlog_later"},
		{name: "other statuses stay unchanged", in: "done", want: "done"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := normalizeTaskStatusForClient(tt.in); got != tt.want {
				t.Fatalf("normalizeTaskStatusForClient(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}

func TestNormalizeTaskIssueType(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{name: "empty defaults to task", in: "", want: "task"},
		{name: "task stays task", in: "task", want: "task"},
		{name: "incident stays incident", in: "incident", want: "incident"},
		{name: "bug stays bug", in: "bug", want: "bug"},
		{name: "epic stays epic", in: "epic", want: "epic"},
		{name: "invalid clears for validation failure", in: "story", want: ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := normalizeTaskIssueType(tt.in); got != tt.want {
				t.Fatalf("normalizeTaskIssueType(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}

func TestBuildTaskUpdateQueryIncludesTitleAndExplicitEmptyContent(t *testing.T) {
	patch := agentTaskPatch{
		ID:      42,
		Status:  strPtr("done"),
		Title:   strPtr("Restore DB ticket title"),
		Content: strPtr(""),
	}

	query, args, err := buildTaskUpdateQuery(patch)
	if err != nil {
		t.Fatalf("buildTaskUpdateQuery returned unexpected error: %v", err)
	}

	wantQuery := "UPDATE dev_agent_tasks SET status = $1, title = $2, content = $3 WHERE id = $4 RETURNING updated"
	if query != wantQuery {
		t.Fatalf("buildTaskUpdateQuery query = %q, want %q", query, wantQuery)
	}

	wantArgs := []interface{}{"done", "Restore DB ticket title", "", 42}
	if !reflect.DeepEqual(args, wantArgs) {
		t.Fatalf("buildTaskUpdateQuery args = %#v, want %#v", args, wantArgs)
	}
}

func TestBuildTaskUpdateQueryRejectsBlankTitle(t *testing.T) {
	_, _, err := buildTaskUpdateQuery(agentTaskPatch{
		ID:    42,
		Title: strPtr("   "),
	})
	if err == nil || err.Error() != "title cannot be empty" {
		t.Fatalf("expected blank title validation error, got %v", err)
	}
}

func TestBuildTaskUpdateQueryRejectsInvalidStatus(t *testing.T) {
	_, _, err := buildTaskUpdateQuery(agentTaskPatch{
		ID:     42,
		Status: strPtr("human_decided"),
	})
	if err == nil || err.Error() != "invalid status" {
		t.Fatalf("expected invalid status error, got %v", err)
	}
}

func TestBuildTaskUpdateQueryAllowsAbortedStatus(t *testing.T) {
	patch := agentTaskPatch{
		ID:     42,
		Status: strPtr("aborted"),
	}

	query, args, err := buildTaskUpdateQuery(patch)
	if err != nil {
		t.Fatalf("buildTaskUpdateQuery returned unexpected error: %v", err)
	}

	wantQuery := "UPDATE dev_agent_tasks SET status = $1 WHERE id = $2 RETURNING updated"
	if query != wantQuery {
		t.Fatalf("buildTaskUpdateQuery query = %q, want %q", query, wantQuery)
	}

	wantArgs := []interface{}{"aborted", 42}
	if !reflect.DeepEqual(args, wantArgs) {
		t.Fatalf("buildTaskUpdateQuery args = %#v, want %#v", args, wantArgs)
	}
}

func TestBuildTaskUpdateQueryIncludesQueueID(t *testing.T) {
	queueID := 7
	queueSlug := "security"
	patch := agentTaskPatch{
		ID:        42,
		QueueID:   &queueID,
		QueueSlug: &queueSlug,
	}

	query, args, err := buildTaskUpdateQuery(patch)
	if err != nil {
		t.Fatalf("buildTaskUpdateQuery returned unexpected error: %v", err)
	}

	wantQuery := "UPDATE dev_agent_tasks SET queue_id = $1 WHERE id = $2 RETURNING updated"
	if query != wantQuery {
		t.Fatalf("buildTaskUpdateQuery query = %q, want %q", query, wantQuery)
	}

	wantArgs := []interface{}{7, 42}
	if !reflect.DeepEqual(args, wantArgs) {
		t.Fatalf("buildTaskUpdateQuery args = %#v, want %#v", args, wantArgs)
	}
}

func TestBuildTaskUpdateQueryIncludesParentID(t *testing.T) {
	parentID := 21
	patch := agentTaskPatch{
		ID:            42,
		ParentID:      &parentID,
		parentTouched: true,
	}

	query, args, err := buildTaskUpdateQuery(patch)
	if err != nil {
		t.Fatalf("buildTaskUpdateQuery returned unexpected error: %v", err)
	}

	wantQuery := "UPDATE dev_agent_tasks SET parent_id = $1 WHERE id = $2 RETURNING updated"
	if query != wantQuery {
		t.Fatalf("buildTaskUpdateQuery query = %q, want %q", query, wantQuery)
	}

	wantArgs := []interface{}{21, 42}
	if !reflect.DeepEqual(args, wantArgs) {
		t.Fatalf("buildTaskUpdateQuery args = %#v, want %#v", args, wantArgs)
	}
}

func TestBuildTaskUpdateQueryClearsQueueWhenRequested(t *testing.T) {
	clearQueue := ""
	patch := agentTaskPatch{
		ID:        42,
		QueueSlug: &clearQueue,
	}

	query, args, err := buildTaskUpdateQuery(patch)
	if err != nil {
		t.Fatalf("buildTaskUpdateQuery returned unexpected error: %v", err)
	}

	wantQuery := "UPDATE dev_agent_tasks SET queue_id = $1 WHERE id = $2 RETURNING updated"
	if query != wantQuery {
		t.Fatalf("buildTaskUpdateQuery query = %q, want %q", query, wantQuery)
	}

	wantArgs := []interface{}{nil, 42}
	if !reflect.DeepEqual(args, wantArgs) {
		t.Fatalf("buildTaskUpdateQuery args = %#v, want %#v", args, wantArgs)
	}
}

func TestBuildTaskUpdateQueryClearsParentWhenRequested(t *testing.T) {
	patch := agentTaskPatch{
		ID:            42,
		parentTouched: true,
	}

	query, args, err := buildTaskUpdateQuery(patch)
	if err != nil {
		t.Fatalf("buildTaskUpdateQuery returned unexpected error: %v", err)
	}

	wantQuery := "UPDATE dev_agent_tasks SET parent_id = $1 WHERE id = $2 RETURNING updated"
	if query != wantQuery {
		t.Fatalf("buildTaskUpdateQuery query = %q, want %q", query, wantQuery)
	}

	wantArgs := []interface{}{nil, 42}
	if !reflect.DeepEqual(args, wantArgs) {
		t.Fatalf("buildTaskUpdateQuery args = %#v, want %#v", args, wantArgs)
	}
}

func TestBuildTaskUpdateQueryAllowsGroupOnlyUpdates(t *testing.T) {
	groupSlugs := []string{"frontend", "testing"}
	patch := agentTaskPatch{
		ID:         42,
		GroupSlugs: &groupSlugs,
	}

	query, args, err := buildTaskUpdateQuery(patch)
	if err != nil {
		t.Fatalf("buildTaskUpdateQuery returned unexpected error: %v", err)
	}

	wantQuery := "UPDATE dev_agent_tasks SET updated = $1 WHERE id = $2 RETURNING updated"
	if query != wantQuery {
		t.Fatalf("buildTaskUpdateQuery query = %q, want %q", query, wantQuery)
	}

	if len(args) != 2 {
		t.Fatalf("buildTaskUpdateQuery args length = %d, want 2", len(args))
	}
	if _, ok := args[0].(time.Time); !ok {
		t.Fatalf("buildTaskUpdateQuery first arg type = %T, want time.Time", args[0])
	}
	if gotID, ok := args[1].(int); !ok || gotID != 42 {
		t.Fatalf("buildTaskUpdateQuery second arg = %#v, want task id 42", args[1])
	}
}

func TestAgentTaskPatchUnmarshalTracksParentPresence(t *testing.T) {
	var patchWithParent agentTaskPatch
	if err := json.Unmarshal([]byte(`{"id":42,"parent_id":21}`), &patchWithParent); err != nil {
		t.Fatalf("json.Unmarshal returned unexpected error: %v", err)
	}
	if !patchWithParent.parentTouched {
		t.Fatalf("expected parentTouched to be true")
	}
	if patchWithParent.ParentID == nil || *patchWithParent.ParentID != 21 {
		t.Fatalf("expected ParentID to be 21, got %#v", patchWithParent.ParentID)
	}

	var patchClearingParent agentTaskPatch
	if err := json.Unmarshal([]byte(`{"id":42,"parent_id":null}`), &patchClearingParent); err != nil {
		t.Fatalf("json.Unmarshal returned unexpected error: %v", err)
	}
	if !patchClearingParent.parentTouched {
		t.Fatalf("expected parentTouched to be true for explicit null")
	}
	if patchClearingParent.ParentID != nil {
		t.Fatalf("expected ParentID to be nil, got %#v", patchClearingParent.ParentID)
	}
}

func TestBuildTaskListQueryWithStatusAndQueueSlug(t *testing.T) {
	query, args, err := buildTaskListQuery("backlog_later", "security", "", "")
	if err != nil {
		t.Fatalf("buildTaskListQuery returned unexpected error: %v", err)
	}

	wantQuery := "SELECT " + taskColumns + taskFromClause + " WHERE t.status = $1 AND q.slug = $2 ORDER BY t.created DESC"
	if query != wantQuery {
		t.Fatalf("buildTaskListQuery query = %q, want %q", query, wantQuery)
	}

	wantArgs := []interface{}{"backlog_later", "security"}
	if !reflect.DeepEqual(args, wantArgs) {
		t.Fatalf("buildTaskListQuery args = %#v, want %#v", args, wantArgs)
	}
}

func TestBuildTaskListQueryRejectsInvalidStatus(t *testing.T) {
	_, _, err := buildTaskListQuery("human_decided", "", "", "")
	if err == nil || err.Error() != "invalid status" {
		t.Fatalf("expected invalid status error, got %v", err)
	}
}

func TestBuildTaskListQueryRejectsInvalidQueueID(t *testing.T) {
	_, _, err := buildTaskListQuery("", "", "abc", "")
	if err == nil || err.Error() != "invalid queue_id" {
		t.Fatalf("expected invalid queue_id error, got %v", err)
	}
}

func TestBuildTaskListQueryAddsGroupFilter(t *testing.T) {
	query, args, err := buildTaskListQuery("", "", "", " Frontend, backend,frontend ")
	if err != nil {
		t.Fatalf("buildTaskListQuery returned unexpected error: %v", err)
	}

	wantQuery := "SELECT " + taskColumns + taskFromClause +
		" WHERE t.id IN (SELECT r.task_id FROM dev_agent_task_group_relations r JOIN dev_agent_task_groups g ON g.id = r.group_id WHERE g.slug = ANY($1)) ORDER BY t.created DESC"
	if query != wantQuery {
		t.Fatalf("buildTaskListQuery query = %q, want %q", query, wantQuery)
	}

	if len(args) != 1 {
		t.Fatalf("buildTaskListQuery args length = %d, want 1", len(args))
	}

	groupArray, ok := args[0].(*pq.StringArray)
	if !ok {
		t.Fatalf("buildTaskListQuery first arg type = %T, want *pq.StringArray", args[0])
	}
	wantGroups := pq.StringArray{"frontend", "backend", "frontend"}
	if !reflect.DeepEqual(*groupArray, wantGroups) {
		t.Fatalf("buildTaskListQuery group arg = %#v, want %#v", groupArray, wantGroups)
	}
}
