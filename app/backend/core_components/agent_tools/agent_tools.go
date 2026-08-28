// agent_tools.go
// Serves backend endpoints for DB-backed agent tasks, groups, and related tool actions.
// Bridges HTTP requests, task registry tables, and backend data-access helpers.
// Keeps the agent-tools workflow contract centralized behind one application API surface.
// Exists so agents and humans use the same validated task lifecycle primitives.

package agent_tools

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	backend "easelect/backend/core_components"

	"github.com/lib/pq"
)

type AgentTask struct {
	ID         int              `json:"id"`
	Title      string           `json:"title"`
	IssueType  string           `json:"issue_type"`
	Status     string           `json:"status"`
	CreatedAt  time.Time        `json:"created_at"`
	UpdatedAt  time.Time        `json:"updated_at"`
	Content    string           `json:"content"`
	Priority   string           `json:"priority"`
	Tags       []string         `json:"tags"`
	ParentID   *int             `json:"parent_id,omitempty"`
	AssignedTo string           `json:"assigned_to,omitempty"`
	QueueID    *int             `json:"queue_id,omitempty"`
	QueueSlug  string           `json:"queue_slug,omitempty"`
	QueueTitle string           `json:"queue_title,omitempty"`
	Groups     []AgentTaskGroup `json:"groups"`
}

type AgentTaskGroup struct {
	ID          int       `json:"id"`
	Slug        string    `json:"slug"`
	Title       string    `json:"title"`
	Description string    `json:"description,omitempty"`
	SortOrder   int       `json:"sort_order"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type agentTaskPatch struct {
	ID            int       `json:"id"`
	Title         *string   `json:"title"`
	IssueType     *string   `json:"issue_type"`
	Status        *string   `json:"status"`
	Content       *string   `json:"content"`
	Priority      *string   `json:"priority"`
	Tags          *[]string `json:"tags"`
	ParentID      *int      `json:"parent_id"`
	AssignedTo    *string   `json:"assigned_to"`
	QueueID       *int      `json:"queue_id"`
	QueueSlug     *string   `json:"queue_slug"`
	GroupSlugs    *[]string `json:"group_slugs"`
	parentTouched bool
	queueTouched  bool
}

// agentTaskCreate extends AgentTask with a group_slugs field for creation.
type agentTaskCreate struct {
	AgentTask
	GroupSlugs []string `json:"group_slugs"`
}

func (p *agentTaskPatch) UnmarshalJSON(data []byte) error {
	type rawPatch struct {
		ID         int             `json:"id"`
		Title      *string         `json:"title"`
		IssueType  *string         `json:"issue_type"`
		Status     *string         `json:"status"`
		Content    *string         `json:"content"`
		Priority   *string         `json:"priority"`
		Tags       *[]string       `json:"tags"`
		ParentID   json.RawMessage `json:"parent_id"`
		AssignedTo *string         `json:"assigned_to"`
		QueueID    *int            `json:"queue_id"`
		QueueSlug  *string         `json:"queue_slug"`
		GroupSlugs *[]string       `json:"group_slugs"`
	}

	var raw rawPatch
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}

	p.ID = raw.ID
	p.Title = raw.Title
	p.IssueType = raw.IssueType
	p.Status = raw.Status
	p.Content = raw.Content
	p.Priority = raw.Priority
	p.Tags = raw.Tags
	p.AssignedTo = raw.AssignedTo
	p.QueueID = raw.QueueID
	p.QueueSlug = raw.QueueSlug
	p.GroupSlugs = raw.GroupSlugs
	p.parentTouched = raw.ParentID != nil
	if p.parentTouched {
		if string(raw.ParentID) == "null" {
			p.ParentID = nil
		} else {
			var parentID int
			if err := json.Unmarshal(raw.ParentID, &parentID); err != nil {
				return fmt.Errorf("invalid parent_id")
			}
			p.ParentID = &parentID
		}
	}

	return nil
}

type sqlQueryExecutor interface {
	Query(query string, args ...interface{}) (*sql.Rows, error)
}

type sqlExecutor interface {
	Exec(query string, args ...interface{}) (sql.Result, error)
}

var validTaskStatuses = map[string]struct{}{
	"new":                     {},
	"backlog":                 {},
	"backlog_later":           {},
	"backlog_nice_to_have":    {},
	"in_progress":             {},
	"on_hold":                 {},
	"awaiting_human_decision": {},
	"done":                    {},
	"rejected":                {},
	"aborted":                 {},
	"archived":                {},
	"to_be_deleted":           {},
}

var legacyTaskStatusAliases = map[string]string{
	"awaiting_review":   "awaiting_human_decision",
	"closed":            "done",
	"done_autonomously": "done",
	"later":             "backlog_later",
	"nice_to_have":      "backlog_nice_to_have",
}

func normalizeTaskStatusForDB(status string) string {
	trimmed := strings.TrimSpace(status)
	if trimmed == "" {
		return ""
	}
	if canonical, ok := legacyTaskStatusAliases[trimmed]; ok {
		return canonical
	}
	return trimmed
}

func normalizeTaskStatusForClient(status string) string {
	return normalizeTaskStatusForDB(status)
}

func isValidTaskStatus(status string) bool {
	_, ok := validTaskStatuses[normalizeTaskStatusForDB(status)]
	return ok
}

func validateTaskStatus(status string) string {
	normalized := normalizeTaskStatusForDB(status)
	if normalized == "" {
		return ""
	}
	if !isValidTaskStatus(normalized) {
		return ""
	}
	return normalized
}

func normalizeTaskIssueType(issueType string) string {
	switch issueType {
	case "", "task", "incident", "bug", "epic":
		if issueType == "" {
			return "task"
		}
		return issueType
	default:
		return ""
	}
}

func normalizeTaskQueueSlug(queueSlug string) string {
	return strings.ToLower(strings.TrimSpace(queueSlug))
}

func resolveTaskQueueIDBySlug(queueSlug string) (*int, error) {
	normalized := normalizeTaskQueueSlug(queueSlug)
	switch normalized {
	case "", "none", "clear", "unassigned":
		return nil, nil
	}

	var queueID int
	err := backend.Db.QueryRow(
		"SELECT id FROM dev_agent_task_queues WHERE slug = $1",
		normalized,
	).Scan(&queueID)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("unknown queue %q", normalized)
	}
	if err != nil {
		return nil, err
	}
	return &queueID, nil
}

func resolveTaskQueueIDByID(queueID int) (*int, error) {
	if queueID <= 0 {
		return nil, nil
	}

	var resolvedID int
	err := backend.Db.QueryRow(
		"SELECT id FROM dev_agent_task_queues WHERE id = $1",
		queueID,
	).Scan(&resolvedID)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("unknown queue_id %d", queueID)
	}
	if err != nil {
		return nil, err
	}
	return &resolvedID, nil
}

func resolveTaskQueueSelectionForCreate(queueID *int, queueSlug string) (*int, error) {
	if strings.TrimSpace(queueSlug) != "" {
		return resolveTaskQueueIDBySlug(queueSlug)
	}
	if queueID != nil {
		return resolveTaskQueueIDByID(*queueID)
	}
	return nil, nil
}

func resolveTaskQueueSelectionForPatch(queueID *int, queueSlug *string) (*int, bool, error) {
	if queueSlug != nil {
		resolved, err := resolveTaskQueueIDBySlug(*queueSlug)
		return resolved, true, err
	}
	if queueID != nil {
		resolved, err := resolveTaskQueueIDByID(*queueID)
		return resolved, true, err
	}
	return nil, false, nil
}

// loadTaskGroups fetches groups for a single task.
func loadTaskGroups(taskID int) ([]AgentTaskGroup, error) {
	rows, err := backend.Db.Query(
		`SELECT g.id, g.slug, g.title, g.description, g.sort_order, g.created, g.updated
		FROM dev_agent_task_group_relations r
		JOIN dev_agent_task_groups g ON g.id = r.group_id
		WHERE r.task_id = $1
		ORDER BY g.sort_order, g.slug`, taskID)
	if err != nil {
		return []AgentTaskGroup{}, err
	}
	defer rows.Close()

	groups := []AgentTaskGroup{}
	for rows.Next() {
		var g AgentTaskGroup
		var desc *string
		if err := rows.Scan(&g.ID, &g.Slug, &g.Title, &desc, &g.SortOrder, &g.CreatedAt, &g.UpdatedAt); err != nil {
			return groups, err
		}
		if desc != nil {
			g.Description = *desc
		}
		groups = append(groups, g)
	}
	return groups, nil
}

// loadTaskGroupsBulk fetches groups for multiple tasks in a single query.
func loadTaskGroupsBulk(taskIDs []int) (map[int][]AgentTaskGroup, error) {
	result := make(map[int][]AgentTaskGroup)
	if len(taskIDs) == 0 {
		return result, nil
	}

	rows, err := backend.Db.Query(
		`SELECT r.task_id, g.id, g.slug, g.title, g.description, g.sort_order, g.created, g.updated
		FROM dev_agent_task_group_relations r
		JOIN dev_agent_task_groups g ON g.id = r.group_id
		WHERE r.task_id = ANY($1)
		ORDER BY r.task_id, g.sort_order, g.slug`, pq.Array(taskIDs))
	if err != nil {
		return result, err
	}
	defer rows.Close()

	for rows.Next() {
		var taskID int
		var g AgentTaskGroup
		var desc *string
		if err := rows.Scan(&taskID, &g.ID, &g.Slug, &g.Title, &desc, &g.SortOrder, &g.CreatedAt, &g.UpdatedAt); err != nil {
			return result, err
		}
		if desc != nil {
			g.Description = *desc
		}
		result[taskID] = append(result[taskID], g)
	}
	return result, nil
}

// resolveGroupSlugsToIDs resolves group slugs to group IDs, returning an error for unknown slugs.
func resolveGroupSlugsToIDs(slugs []string) ([]int, error) {
	return resolveGroupSlugsToIDsWithQuerier(backend.Db, slugs)
}

func resolveGroupSlugsToIDsWithQuerier(db sqlQueryExecutor, slugs []string) ([]int, error) {
	if len(slugs) == 0 {
		return nil, nil
	}
	normalized := make([]string, 0, len(slugs))
	seen := make(map[string]struct{}, len(slugs))
	for _, s := range slugs {
		slug := strings.ToLower(strings.TrimSpace(s))
		if slug == "" {
			continue
		}
		if _, ok := seen[slug]; ok {
			continue
		}
		seen[slug] = struct{}{}
		normalized = append(normalized, slug)
	}
	if len(normalized) == 0 {
		return nil, nil
	}

	rows, err := db.Query(
		"SELECT id, slug FROM dev_agent_task_groups WHERE slug = ANY($1)",
		pq.Array(normalized))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	found := make(map[string]int)
	for rows.Next() {
		var id int
		var slug string
		if err := rows.Scan(&id, &slug); err != nil {
			return nil, err
		}
		found[slug] = id
	}

	var ids []int
	for _, slug := range normalized {
		id, ok := found[slug]
		if !ok {
			return nil, fmt.Errorf("unknown group %q", slug)
		}
		ids = append(ids, id)
	}
	return ids, nil
}

// replaceTaskGroups sets the group membership for a task (replace-all strategy).
func replaceTaskGroups(taskID int, groupIDs []int) error {
	return replaceTaskGroupsWithExecutor(backend.Db, taskID, groupIDs)
}

func replaceTaskGroupsWithExecutor(exec sqlExecutor, taskID int, groupIDs []int) error {
	_, err := exec.Exec("DELETE FROM dev_agent_task_group_relations WHERE task_id = $1", taskID)
	if err != nil {
		return err
	}
	for _, gid := range groupIDs {
		_, err := exec.Exec(
			"INSERT INTO dev_agent_task_group_relations (task_id, group_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
			taskID, gid)
		if err != nil {
			return err
		}
	}
	return nil
}

// Init initializes the agent tools app
func Init() {
	// No initialization needed for now
}

// TasksHandler dispatches requests to the appropriate handler based on method
