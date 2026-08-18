// agent_task_todos.go
// Serves structured todo rows for DB-backed agent tasks.
// Bridges dev_agent_tasks, dev_agent_task_todos, and the agent-tools HTTP API.
// Keeps checklist completion independent from the parent ticket workflow state.
// Exists so tickets can hold many small done/todo records without markdown rewrites.

package agent_tools

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/event_bus"
	e_sessions "easelect/backend/core_components/sessions"
)

const agentTaskTodoTableName = "dev_agent_task_todos"

var validTaskTodoStatuses = map[string]struct{}{
	"todo":           {},
	"partially_done": {},
	"needs_review":   {},
	"not_applicable": {},
	"done":           {},
}

type AgentTaskTodo struct {
	ID                  int64      `json:"id"`
	TaskID              int        `json:"task_id"`
	ParentTodoID        *int64     `json:"parent_todo_id,omitempty"`
	TodoText            string     `json:"todo_text"`
	Status              string     `json:"status"`
	SortOrder           int        `json:"sort_order"`
	CreatedBy           *int       `json:"created_by,omitempty"`
	CompletedBy         *int       `json:"completed_by,omitempty"`
	CreatedByUsername   string     `json:"created_by_username,omitempty"`
	CompletedByUsername string     `json:"completed_by_username,omitempty"`
	CreatedAt           time.Time  `json:"created_at"`
	UpdatedAt           time.Time  `json:"updated_at"`
	CompletedAt         *time.Time `json:"completed_at,omitempty"`
}

type agentTaskTodoCreate struct {
	TaskID       int    `json:"task_id"`
	ParentTodoID *int64 `json:"parent_todo_id"`
	TodoText     string `json:"todo_text"`
	SortOrder    *int   `json:"sort_order"`
}

type agentTaskTodoPatch struct {
	ID        int64   `json:"id"`
	TodoText  *string `json:"todo_text"`
	Status    *string `json:"status"`
	SortOrder *int    `json:"sort_order"`
}

// normalizeTaskTodoStatus canonicalizes user/API status input into the todo status vocabulary.
func normalizeTaskTodoStatus(status string) string {
	trimmed := strings.ToLower(strings.TrimSpace(status))
	if trimmed == "" {
		return "todo"
	}
	return trimmed
}

// validateTaskTodoStatus verifies that a todo status is supported by the DB lookup and API contract.
func validateTaskTodoStatus(status string) string {
	normalized := normalizeTaskTodoStatus(status)
	if _, ok := validTaskTodoStatuses[normalized]; ok {
		return normalized
	}
	return ""
}

// validateTaskTodoText trims and bounds todo text before it enters dev_agent_task_todos.
func validateTaskTodoText(text string) string {
	trimmed := strings.TrimSpace(text)
	if trimmed == "" || len(trimmed) > 5000 {
		return ""
	}
	return trimmed
}

// currentAgentToolUserID reads the already-authenticated session user for todo authorship fields.
func currentAgentToolUserID(r *http.Request) int {
	store := e_sessions.GetStore()
	session, err := store.Get(r, e_sessions.SessionName)
	if err != nil {
		return 0
	}
	userID, _ := session.Values["user_id"].(int)
	return userID
}

// TaskTodosHandler dispatches ticket-todo CRUD calls for authenticated tool users.
func TaskTodosHandler(w http.ResponseWriter, r *http.Request) {
	if !requireAuthenticatedAgentToolUser(w, r) {
		return
	}

	switch r.Method {
	case http.MethodGet:
		ListTaskTodosHandler(w, r)
	case http.MethodPost:
		CreateTaskTodoHandler(w, r)
	case http.MethodPut, http.MethodPatch:
		UpdateTaskTodoHandler(w, r)
	case http.MethodDelete:
		DeleteTaskTodoHandler(w, r)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// scanTaskTodo scans one dev_agent_task_todos row plus optional username joins.
func scanTaskTodo(scanner interface {
	Scan(dest ...interface{}) error
}) (AgentTaskTodo, error) {
	var todo AgentTaskTodo
	var parentID, createdBy, completedBy sql.NullInt64
	var completedAt sql.NullTime

	err := scanner.Scan(
		&todo.ID,
		&todo.TaskID,
		&parentID,
		&todo.TodoText,
		&todo.Status,
		&todo.SortOrder,
		&createdBy,
		&completedBy,
		&todo.CreatedByUsername,
		&todo.CompletedByUsername,
		&todo.CreatedAt,
		&todo.UpdatedAt,
		&completedAt,
	)
	if err != nil {
		return todo, err
	}

	if parentID.Valid {
		value := parentID.Int64
		todo.ParentTodoID = &value
	}
	if createdBy.Valid {
		value := int(createdBy.Int64)
		todo.CreatedBy = &value
	}
	if completedBy.Valid {
		value := int(completedBy.Int64)
		todo.CompletedBy = &value
	}
	if completedAt.Valid {
		value := completedAt.Time
		todo.CompletedAt = &value
	}
	todo.Status = validateTaskTodoStatus(todo.Status)

	return todo, nil
}

const taskTodoColumns = `td.id, td.task_id, td.parent_todo_id, td.todo_text, td.status, td.sort_order, td.created_by, td.completed_by, COALESCE(created_user.username, ''), COALESCE(completed_user.username, ''), td.created, td.updated, td.completed`
const taskTodoFromClause = ` FROM dev_agent_task_todos td LEFT JOIN system_users created_user ON created_user.id = td.created_by LEFT JOIN system_users completed_user ON completed_user.id = td.completed_by`

// taskExistsForTodos checks the parent ticket before listing or creating todo rows.
func taskExistsForTodos(taskID int) bool {
	var exists bool
	err := backend.Db.QueryRow("SELECT EXISTS (SELECT 1 FROM dev_agent_tasks WHERE id = $1)", taskID).Scan(&exists)
	return err == nil && exists
}

// fetchTaskTodoByID reloads one todo row after create/update so callers receive canonical timestamps.
func fetchTaskTodoByID(id interface{}) (AgentTaskTodo, error) {
	query := "SELECT " + taskTodoColumns + taskTodoFromClause + " WHERE td.id = $1"
	return scanTaskTodo(backend.Db.QueryRow(query, id))
}

// resolveTaskTodoSortOrder places new todos after sibling rows unless the caller supplies an order.
func resolveTaskTodoSortOrder(taskID int, parentTodoID *int64, explicitSortOrder *int) (int, error) {
	if explicitSortOrder != nil {
		return *explicitSortOrder, nil
	}

	query := "SELECT COALESCE(MAX(sort_order), 0) + 10 FROM dev_agent_task_todos WHERE task_id = $1 AND parent_todo_id IS NULL"
	args := []interface{}{taskID}
	if parentTodoID != nil {
		query = "SELECT COALESCE(MAX(sort_order), 0) + 10 FROM dev_agent_task_todos WHERE task_id = $1 AND parent_todo_id = $2"
		args = append(args, *parentTodoID)
	}

	var sortOrder int
	err := backend.Db.QueryRow(query, args...).Scan(&sortOrder)
	return sortOrder, err
}

// buildTaskTodoUpdateQuery builds the narrow UPDATE statement for mutable todo fields only.
func buildTaskTodoUpdateQuery(patch agentTaskTodoPatch, userID int) (string, []interface{}, error) {
	query := "UPDATE dev_agent_task_todos SET "
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

	appendRaw := func(expression string) {
		if !first {
			query += ", "
		}
		query += expression
		first = false
	}

	if patch.TodoText != nil {
		text := validateTaskTodoText(*patch.TodoText)
		if text == "" {
			return "", nil, fmt.Errorf("todo_text must be 1-5000 characters")
		}
		appendField("todo_text", text)
	}
	if patch.Status != nil {
		status := validateTaskTodoStatus(*patch.Status)
		if status == "" {
			return "", nil, fmt.Errorf("invalid status")
		}
		appendField("status", status)
		if status == "done" {
			appendRaw("completed = NOW()")
			appendField("completed_by", userID)
		} else {
			appendRaw("completed = NULL")
			appendRaw("completed_by = NULL")
		}
	}
	if patch.SortOrder != nil {
		appendField("sort_order", *patch.SortOrder)
	}

	if first {
		return "", nil, fmt.Errorf("no fields to update")
	}

	query += fmt.Sprintf(" WHERE id = $%d RETURNING updated", argID)
	args = append(args, patch.ID)
	return query, args, nil
}

// ListTaskTodosHandler returns all todo rows for one task in stable tree order.
func ListTaskTodosHandler(w http.ResponseWriter, r *http.Request) {
	taskIDStr := strings.TrimSpace(r.URL.Query().Get("task_id"))
	if taskIDStr == "" {
		http.Error(w, "task_id is required", http.StatusBadRequest)
		return
	}

	taskID, err := strconv.Atoi(taskIDStr)
	if err != nil || taskID <= 0 {
		http.Error(w, "task_id must be a positive integer", http.StatusBadRequest)
		return
	}
	if !taskExistsForTodos(taskID) {
		http.Error(w, "Task not found", http.StatusNotFound)
		return
	}

	query := "SELECT " + taskTodoColumns + taskTodoFromClause +
		" WHERE td.task_id = $1 ORDER BY COALESCE(td.parent_todo_id, td.id), CASE WHEN td.parent_todo_id IS NULL THEN 0 ELSE 1 END, td.sort_order, td.id"
	rows, err := backend.Db.Query(query, taskID)
	if err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	todos := []AgentTaskTodo{}
	for rows.Next() {
		todo, err := scanTaskTodo(rows)
		if err != nil {
			log.Printf("Error scanning task todo: %v", err)
			continue
		}
		todos = append(todos, todo)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(todos)
}

// CreateTaskTodoHandler creates a todo row under one ticket or under one top-level todo.
func CreateTaskTodoHandler(w http.ResponseWriter, r *http.Request) {
	var input agentTaskTodoCreate
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	if input.TaskID <= 0 {
		http.Error(w, "task_id is required", http.StatusBadRequest)
		return
	}
	if !taskExistsForTodos(input.TaskID) {
		http.Error(w, "Task not found", http.StatusNotFound)
		return
	}

	todoText := validateTaskTodoText(input.TodoText)
	if todoText == "" {
		http.Error(w, "todo_text must be 1-5000 characters", http.StatusBadRequest)
		return
	}

	sortOrder, err := resolveTaskTodoSortOrder(input.TaskID, input.ParentTodoID, input.SortOrder)
	if err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	userID := currentAgentToolUserID(r)
	var newID int64
	err = backend.Db.QueryRow(
		`INSERT INTO dev_agent_task_todos (task_id, parent_todo_id, todo_text, status, sort_order, created_by)
		 VALUES ($1, $2, $3, 'todo', $4, $5)
		 RETURNING id`,
		input.TaskID, input.ParentTodoID, todoText, sortOrder, userID,
	).Scan(&newID)
	if err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}
	event_bus.Bus.Publish(agentTaskTodoTableName, event_bus.Event{
		Table:  agentTaskTodoTableName,
		RowID:  newID,
		Action: "create",
	})

	todo, err := fetchTaskTodoByID(newID)
	if err != nil {
		http.Error(w, "Todo created but could not be reloaded", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(todo)
}

// UpdateTaskTodoHandler changes todo text, order, or done/todo status without changing task status.
func UpdateTaskTodoHandler(w http.ResponseWriter, r *http.Request) {
	var patch agentTaskTodoPatch
	if err := json.NewDecoder(r.Body).Decode(&patch); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	if patch.ID <= 0 {
		http.Error(w, "id is required", http.StatusBadRequest)
		return
	}

	query, args, err := buildTaskTodoUpdateQuery(patch, currentAgentToolUserID(r))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	var updatedAt time.Time
	err = backend.Db.QueryRow(query, args...).Scan(&updatedAt)
	if err == sql.ErrNoRows {
		http.Error(w, "Todo not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}
	event_bus.Bus.Publish(agentTaskTodoTableName, event_bus.Event{
		Table:         agentTaskTodoTableName,
		RowID:         patch.ID,
		Action:        "update",
		ChangedFields: collectChangedTaskTodoFields(patch),
	})

	todo, err := fetchTaskTodoByID(patch.ID)
	if err != nil {
		http.Error(w, "Todo updated but could not be reloaded", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(todo)
}

// collectChangedTaskTodoFields names todo fields for event-bus subscribers and audit readers.
func collectChangedTaskTodoFields(patch agentTaskTodoPatch) []string {
	fields := []string{}
	if patch.TodoText != nil {
		fields = append(fields, "todo_text")
	}
	if patch.Status != nil {
		fields = append(fields, "status")
	}
	if patch.SortOrder != nil {
		fields = append(fields, "sort_order")
	}
	return fields
}

// DeleteTaskTodoHandler removes a todo row; child todos cascade with their parent.
func DeleteTaskTodoHandler(w http.ResponseWriter, r *http.Request) {
	idStr := strings.TrimSpace(r.URL.Query().Get("id"))
	if idStr == "" {
		http.Error(w, "id is required", http.StatusBadRequest)
		return
	}
	todoID, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil || todoID <= 0 {
		http.Error(w, "id must be a positive integer", http.StatusBadRequest)
		return
	}

	result, err := backend.Db.Exec("DELETE FROM dev_agent_task_todos WHERE id = $1", todoID)
	if err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}
	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		http.Error(w, "Todo not found", http.StatusNotFound)
		return
	}
	event_bus.Bus.Publish(agentTaskTodoTableName, event_bus.Event{
		Table:  agentTaskTodoTableName,
		RowID:  todoID,
		Action: "delete",
	})

	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"success":true}`))
}
