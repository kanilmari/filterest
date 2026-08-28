// task_group_handlers.go
// Serves HTTP CRUD endpoints for agent task-group definitions.
// Bridges group request payloads and the shared database connection.
// Keeps group administration separate from task lifecycle request handling.
// Exists so the agent-tools backend remains reviewable and modular.

package agent_tools

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"

	backend "easelect/backend/core_components"
)

func TaskGroupsHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		listTaskGroups(w, r)
	case http.MethodPost:
		createTaskGroup(w, r)
	case http.MethodPut, http.MethodPatch:
		updateTaskGroup(w, r)
	case http.MethodDelete:
		deleteTaskGroup(w, r)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func listTaskGroups(w http.ResponseWriter, r *http.Request) {
	rows, err := backend.Db.Query(
		"SELECT id, slug, title, description, sort_order, created, updated FROM dev_agent_task_groups ORDER BY sort_order, slug")
	if err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	groups := []AgentTaskGroup{}
	for rows.Next() {
		var g AgentTaskGroup
		var desc *string
		if err := rows.Scan(&g.ID, &g.Slug, &g.Title, &desc, &g.SortOrder, &g.CreatedAt, &g.UpdatedAt); err != nil {
			log.Printf("Error scanning task group: %v", err)
			continue
		}
		if desc != nil {
			g.Description = *desc
		}
		groups = append(groups, g)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(groups)
}

func createTaskGroup(w http.ResponseWriter, r *http.Request) {
	var g AgentTaskGroup
	if err := json.NewDecoder(r.Body).Decode(&g); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	g.Slug = strings.ToLower(strings.TrimSpace(g.Slug))
	g.Title = strings.TrimSpace(g.Title)
	if g.Slug == "" || g.Title == "" {
		http.Error(w, "slug and title are required", http.StatusBadRequest)
		return
	}

	err := backend.Db.QueryRow(
		`INSERT INTO dev_agent_task_groups (slug, title, description, sort_order)
		VALUES ($1, $2, $3, $4) RETURNING id, created, updated`,
		g.Slug, g.Title, g.Description, g.SortOrder,
	).Scan(&g.ID, &g.CreatedAt, &g.UpdatedAt)
	if err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(g)
}

func updateTaskGroup(w http.ResponseWriter, r *http.Request) {
	idStr := r.URL.Query().Get("id")
	if idStr == "" {
		http.Error(w, "id query parameter is required", http.StatusBadRequest)
		return
	}
	id, err := strconv.Atoi(idStr)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	var input struct {
		Slug        *string `json:"slug"`
		Title       *string `json:"title"`
		Description *string `json:"description"`
		SortOrder   *int    `json:"sort_order"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	query := "UPDATE dev_agent_task_groups SET "
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

	if input.Slug != nil {
		slug := strings.ToLower(strings.TrimSpace(*input.Slug))
		if slug == "" {
			http.Error(w, "slug cannot be empty", http.StatusBadRequest)
			return
		}
		appendField("slug", slug)
	}
	if input.Title != nil {
		title := strings.TrimSpace(*input.Title)
		if title == "" {
			http.Error(w, "title cannot be empty", http.StatusBadRequest)
			return
		}
		appendField("title", title)
	}
	if input.Description != nil {
		appendField("description", *input.Description)
	}
	if input.SortOrder != nil {
		appendField("sort_order", *input.SortOrder)
	}

	if first {
		http.Error(w, "no fields to update", http.StatusBadRequest)
		return
	}

	query += fmt.Sprintf(" WHERE id = $%d RETURNING id, slug, title, description, sort_order, created, updated", argID)
	args = append(args, id)

	var g AgentTaskGroup
	var desc *string
	err = backend.Db.QueryRow(query, args...).Scan(&g.ID, &g.Slug, &g.Title, &desc, &g.SortOrder, &g.CreatedAt, &g.UpdatedAt)
	if err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}
	if desc != nil {
		g.Description = *desc
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(g)
}

func deleteTaskGroup(w http.ResponseWriter, r *http.Request) {
	idStr := r.URL.Query().Get("id")
	if idStr == "" {
		http.Error(w, "id query parameter is required", http.StatusBadRequest)
		return
	}

	result, err := backend.Db.Exec("DELETE FROM dev_agent_task_groups WHERE id = $1", idStr)
	if err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		http.Error(w, "Group not found", http.StatusNotFound)
		return
	}

	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"message": "Group deleted"}`))
}
