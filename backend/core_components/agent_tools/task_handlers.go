// task_handlers.go
// Serves HTTP CRUD endpoints for database-backed agent tasks.
// Bridges validated task payloads, task query helpers, and event publication.
// Keeps task request handling separate from shared task metadata helpers.
// Exists so the public agent-tools backend stays within the project file-size boundary.

package agent_tools

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/event_bus"

	"github.com/lib/pq"
)

func TasksHandler(w http.ResponseWriter, r *http.Request) {
	if !requireAuthenticatedAgentToolUser(w, r) {
		return
	}

	switch r.Method {
	case http.MethodGet:
		ListTasksHandler(w, r)
	case http.MethodPost:
		CreateTaskHandler(w, r)
	case http.MethodPut, http.MethodPatch:
		UpdateTaskHandler(w, r)
	case http.MethodDelete:
		DeleteTaskHandler(w, r)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// scanTask scans a single task row from the standard column set.
func scanTask(scanner interface {
	Scan(dest ...interface{}) error
}) (AgentTask, error) {
	var t AgentTask
	var updatedAt *time.Time
	var assignedTo, queueSlug, queueTitle *string
	var parentID, queueID *int

	err := scanner.Scan(
		&t.ID, &t.Title, &t.IssueType, &t.Status, &t.CreatedAt, &updatedAt,
		&t.Content,
		&t.Priority, pq.Array(&t.Tags), &parentID, &assignedTo, &queueID, &queueSlug, &queueTitle,
	)
	if err != nil {
		return t, err
	}

	if updatedAt != nil {
		t.UpdatedAt = *updatedAt
	}
	if parentID != nil {
		t.ParentID = parentID
	}
	if assignedTo != nil {
		t.AssignedTo = *assignedTo
	}
	if queueID != nil {
		t.QueueID = queueID
	}
	if queueSlug != nil {
		t.QueueSlug = *queueSlug
	}
	if queueTitle != nil {
		t.QueueTitle = *queueTitle
	}
	if t.Tags == nil {
		t.Tags = []string{}
	}
	if t.Groups == nil {
		t.Groups = []AgentTaskGroup{}
	}
	t.IssueType = normalizeTaskIssueType(t.IssueType)
	t.Status = normalizeTaskStatusForClient(t.Status)

	return t, nil
}

const taskColumns = `t.id, t.title, t.issue_type, t.status, t.created, t.updated, t.content, t.priority, t.tags, t.parent_id, t.assigned_to, t.queue_id, q.slug AS queue_slug, q.title AS queue_title`
const taskFromClause = ` FROM dev_agent_tasks t LEFT JOIN dev_agent_task_queues q ON q.id = t.queue_id`
const agentTaskTableName = "dev_agent_tasks"

func collectChangedTaskFields(patch agentTaskPatch) []string {
	fields := []string{}
	if patch.Title != nil {
		fields = append(fields, "title")
	}
	if patch.IssueType != nil {
		fields = append(fields, "issue_type")
	}
	if patch.Status != nil {
		fields = append(fields, "status")
	}
	if patch.Content != nil {
		fields = append(fields, "content")
	}
	if patch.Priority != nil {
		fields = append(fields, "priority")
	}
	if patch.Tags != nil {
		fields = append(fields, "tags")
	}
	if patch.parentTouched {
		fields = append(fields, "parent_id")
	}
	if patch.AssignedTo != nil {
		fields = append(fields, "assigned_to")
	}
	if patch.queueTouched || patch.QueueSlug != nil {
		fields = append(fields, "queue_id")
	}
	if patch.GroupSlugs != nil {
		fields = append(fields, "group_slugs")
	}
	return fields
}

func fetchTaskByID(id interface{}) (AgentTask, error) {
	query := "SELECT " + taskColumns + taskFromClause + " WHERE t.id = $1"
	row := backend.Db.QueryRow(query, id)
	t, err := scanTask(row)
	if err != nil {
		return t, err
	}
	groups, err := loadTaskGroups(t.ID)
	if err != nil {
		return t, err
	}
	t.Groups = groups
	return t, nil
}

func buildTaskUpdateQuery(patch agentTaskPatch) (string, []interface{}, error) {
	query := "UPDATE dev_agent_tasks SET "
	var args []interface{}
	argID := 1
	first := true

	appendField := func(column string, value interface{}) {
		if !first {
			query += ", "
		}
		query += fmt.Sprintf("%s = $%d", column, argID)
		args = append(args, value)
		argID++
		first = false
	}

	validateNonBlank := func(fieldName string, value *string) error {
		if value == nil {
			return nil
		}
		if strings.TrimSpace(*value) == "" {
			return fmt.Errorf("%s cannot be empty", fieldName)
		}
		return nil
	}

	if patch.Status != nil {
		normalizedStatus := validateTaskStatus(*patch.Status)
		if normalizedStatus == "" {
			return "", nil, fmt.Errorf("invalid status")
		}
		appendField("status", normalizedStatus)
	}
	if patch.IssueType != nil {
		normalized := normalizeTaskIssueType(*patch.IssueType)
		if normalized == "" {
			return "", nil, fmt.Errorf("invalid issue_type")
		}
		appendField("issue_type", normalized)
	}
	if err := validateNonBlank("title", patch.Title); err != nil {
		return "", nil, err
	}
	if patch.Title != nil {
		appendField("title", *patch.Title)
	}
	if patch.Content != nil {
		appendField("content", *patch.Content)
	}
	if patch.Priority != nil {
		appendField("priority", *patch.Priority)
	}
	if patch.Tags != nil {
		appendField("tags", pq.Array(*patch.Tags))
	}
	if patch.parentTouched {
		if patch.ParentID == nil {
			appendField("parent_id", nil)
		} else {
			appendField("parent_id", *patch.ParentID)
		}
	}
	if patch.AssignedTo != nil {
		appendField("assigned_to", *patch.AssignedTo)
	}
	if patch.queueTouched || patch.QueueSlug != nil || patch.QueueID != nil {
		if patch.QueueID == nil {
			appendField("queue_id", nil)
		} else {
			appendField("queue_id", *patch.QueueID)
		}
	}

	if first {
		if patch.GroupSlugs != nil {
			// Group-only updates still change task state and should advance the updated timestamp.
			appendField("updated", time.Now())
		} else {
			return "", nil, fmt.Errorf("no fields to update")
		}
	}

	query += fmt.Sprintf(" WHERE id = $%d RETURNING updated", argID)
	args = append(args, patch.ID)
	return query, args, nil
}

func buildTaskListQuery(status, queueSlug, queueIDStr, groupSlugs string) (string, []interface{}, error) {
	query := "SELECT " + taskColumns + taskFromClause
	conditions := []string{}
	args := []interface{}{}

	if status != "" {
		normalizedStatus := validateTaskStatus(status)
		if normalizedStatus == "" {
			return "", nil, fmt.Errorf("invalid status")
		}
		args = append(args, normalizedStatus)
		conditions = append(conditions, fmt.Sprintf("t.status = $%d", len(args)))
	}

	if strings.TrimSpace(queueSlug) != "" {
		args = append(args, normalizeTaskQueueSlug(queueSlug))
		conditions = append(conditions, fmt.Sprintf("q.slug = $%d", len(args)))
	}

	if strings.TrimSpace(queueIDStr) != "" {
		queueID, err := strconv.Atoi(strings.TrimSpace(queueIDStr))
		if err != nil {
			return "", nil, fmt.Errorf("invalid queue_id")
		}
		args = append(args, queueID)
		conditions = append(conditions, fmt.Sprintf("t.queue_id = $%d", len(args)))
	}

	if strings.TrimSpace(groupSlugs) != "" {
		slugList := strings.Split(groupSlugs, ",")
		normalized := make([]string, 0, len(slugList))
		for _, s := range slugList {
			s = strings.ToLower(strings.TrimSpace(s))
			if s != "" {
				normalized = append(normalized, s)
			}
		}
		if len(normalized) > 0 {
			args = append(args, pq.Array(normalized))
			conditions = append(conditions, fmt.Sprintf(
				"t.id IN (SELECT r.task_id FROM dev_agent_task_group_relations r JOIN dev_agent_task_groups g ON g.id = r.group_id WHERE g.slug = ANY($%d))",
				len(args)))
		}
	}

	if len(conditions) > 0 {
		query += " WHERE " + strings.Join(conditions, " AND ")
	}

	query += " ORDER BY t.created DESC"
	return query, args, nil
}

// ListTasksHandler returns all tasks, optionally filtered by status or queue.
// If ?id=N is provided, returns a single task by ID.
func ListTasksHandler(w http.ResponseWriter, r *http.Request) {
	// Single task by ID
	if idStr := r.URL.Query().Get("id"); idStr != "" {
		t, err := fetchTaskByID(idStr)
		if err != nil {
			http.Error(w, "Task not found", http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(t)
		return
	}

	status := strings.TrimSpace(r.URL.Query().Get("status"))
	queueSlug := strings.TrimSpace(r.URL.Query().Get("queue"))
	if queueSlug == "" {
		queueSlug = strings.TrimSpace(r.URL.Query().Get("queue_slug"))
	}
	queueIDStr := strings.TrimSpace(r.URL.Query().Get("queue_id"))
	groupSlugs := strings.TrimSpace(r.URL.Query().Get("groups"))

	query, args, err := buildTaskListQuery(status, queueSlug, queueIDStr, groupSlugs)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	rows, err := backend.Db.Query(query, args...)
	if err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	tasks := []AgentTask{}
	taskIDs := []int{}
	for rows.Next() {
		t, err := scanTask(rows)
		if err != nil {
			log.Printf("Error scanning task: %v", err)
			continue
		}
		tasks = append(tasks, t)
		taskIDs = append(taskIDs, t.ID)
	}

	groupMap, err := loadTaskGroupsBulk(taskIDs)
	if err != nil {
		log.Printf("Error loading task groups: %v", err)
	}
	for i := range tasks {
		if groups, ok := groupMap[tasks[i].ID]; ok {
			tasks[i].Groups = groups
		} else {
			tasks[i].Groups = []AgentTaskGroup{}
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(tasks)
}

// CreateTaskHandler creates a new task
func CreateTaskHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var input agentTaskCreate
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	t := input.AgentTask

	if strings.TrimSpace(t.Title) == "" {
		http.Error(w, "Title is required", http.StatusBadRequest)
		return
	}
	if t.Status == "" {
		t.Status = "new"
	}
	t.IssueType = normalizeTaskIssueType(t.IssueType)
	if t.IssueType == "" {
		http.Error(w, "Invalid issue_type", http.StatusBadRequest)
		return
	}
	t.Status = validateTaskStatus(t.Status)
	if t.Status == "" {
		http.Error(w, "Invalid status", http.StatusBadRequest)
		return
	}
	if t.Priority == "" {
		t.Priority = "normal"
	}
	if t.Tags == nil {
		t.Tags = []string{}
	}

	queueID, err := resolveTaskQueueSelectionForCreate(t.QueueID, t.QueueSlug)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	t.QueueID = queueID

	tx, err := backend.Db.Begin()
	if err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()

	// Resolve group slugs before insert.
	var groupIDs []int
	if len(input.GroupSlugs) > 0 {
		groupIDs, err = resolveGroupSlugsToIDsWithQuerier(tx, input.GroupSlugs)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
	}

	query := `
		INSERT INTO dev_agent_tasks (title, issue_type, status, content, priority, tags, parent_id, assigned_to, queue_id, updated)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
		RETURNING id, created, updated
	`

	err = tx.QueryRow(query,
		t.Title, t.IssueType, t.Status, t.Content, t.Priority, pq.Array(t.Tags), t.ParentID, t.AssignedTo, t.QueueID,
	).Scan(&t.ID, &t.CreatedAt, &t.UpdatedAt)
	if err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Insert group memberships
	if len(groupIDs) > 0 {
		if err := replaceTaskGroupsWithExecutor(tx, t.ID, groupIDs); err != nil {
			http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
			return
		}
	}

	if err := tx.Commit(); err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}
	event_bus.Bus.Publish(agentTaskTableName, event_bus.Event{
		Table:  agentTaskTableName,
		RowID:  int64(t.ID),
		Action: "create",
	})

	t, err = fetchTaskByID(t.ID)
	if err != nil {
		http.Error(w, "Task created but could not be reloaded", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(t)
}

// UpdateTaskHandler updates an existing task
func UpdateTaskHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut && r.Method != http.MethodPatch {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var patch agentTaskPatch
	if err := json.NewDecoder(r.Body).Decode(&patch); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	if patch.ID == 0 {
		http.Error(w, "ID is required", http.StatusBadRequest)
		return
	}

	queueID, queueProvided, err := resolveTaskQueueSelectionForPatch(patch.QueueID, patch.QueueSlug)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if queueProvided || patch.QueueSlug != nil {
		patch.QueueID = queueID
	}
	patch.queueTouched = queueProvided

	tx, err := backend.Db.Begin()
	if err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()

	// Resolve group slugs if provided.
	var groupIDs []int
	groupsProvided := patch.GroupSlugs != nil
	if groupsProvided {
		groupIDs, err = resolveGroupSlugsToIDsWithQuerier(tx, *patch.GroupSlugs)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
	}

	query, args, err := buildTaskUpdateQuery(patch)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	var updatedAt time.Time
	err = tx.QueryRow(query, args...).Scan(&updatedAt)
	if err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Replace group memberships if provided
	if groupsProvided {
		if err := replaceTaskGroupsWithExecutor(tx, patch.ID, groupIDs); err != nil {
			http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
			return
		}
	}

	if err := tx.Commit(); err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}
	event_bus.Bus.Publish(agentTaskTableName, event_bus.Event{
		Table:         agentTaskTableName,
		RowID:         int64(patch.ID),
		Action:        "update",
		ChangedFields: collectChangedTaskFields(patch),
	})

	task, err := fetchTaskByID(patch.ID)
	if err != nil {
		http.Error(w, "Task updated but could not be reloaded", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(task)
}

// DeleteTaskHandler deletes a task
func DeleteTaskHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	idStr := r.URL.Query().Get("id")
	if idStr == "" {
		http.Error(w, "ID is required", http.StatusBadRequest)
		return
	}

	query := "DELETE FROM dev_agent_tasks WHERE id = $1"
	result, err := backend.Db.Exec(query, idStr)
	if err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		http.Error(w, "Task not found", http.StatusNotFound)
		return
	}

	if taskID, err := strconv.ParseInt(idStr, 10, 64); err == nil {
		event_bus.Bus.Publish(agentTaskTableName, event_bus.Event{
			Table:  agentTaskTableName,
			RowID:  taskID,
			Action: "delete",
		})
	}

	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"message": "Task deleted"}`))
}

// TaskGroupsHandler serves CRUD for task group definitions.
