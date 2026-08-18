// bee_messages.go
// Serves backend endpoints for Queen 2 inter-agent bee messages.
// Bridges agent conversations, task tracking, and threaded message history via HTTP API.
// Exists to give the Queen 2 agent team a persistent, auditable communication channel.

package agent_tools

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"time"

	backend "easelect/backend/core_components"
)

// BeeMessage represents a single inter-agent message.
type BeeMessage struct {
	ID          int64           `json:"id"`
	Title       *string         `json:"title,omitempty"`
	Content     json.RawMessage `json:"content"`
	UserID      int             `json:"user_id"`
	TaskID      *int            `json:"task_id,omitempty"`
	ThreadID    string          `json:"thread_id"`
	InReplyToID *int64          `json:"in_reply_to_id,omitempty"`
	Created     time.Time       `json:"created"`
	Updated     time.Time       `json:"updated"`
}

const beeMessageColumns = `id, title, content, user_id, task_id, thread_id, in_reply_to_id, created, updated`

// scanBeeMessage scans a single bee message row from the standard column set.
func scanBeeMessage(scanner interface {
	Scan(dest ...interface{}) error
}) (BeeMessage, error) {
	var m BeeMessage
	var title *string
	var taskID *int
	var inReplyToID *int64

	err := scanner.Scan(
		&m.ID, &title, &m.Content, &m.UserID, &taskID,
		&m.ThreadID, &inReplyToID, &m.Created, &m.Updated,
	)
	if err != nil {
		return m, err
	}

	if title != nil {
		m.Title = title
	}
	if taskID != nil {
		m.TaskID = taskID
	}
	if inReplyToID != nil {
		m.InReplyToID = inReplyToID
	}

	return m, nil
}

// BeeMessagesHandler dispatches requests to the appropriate handler based on method.
// Messages are append-only: GET, POST, DELETE only. No PUT/PATCH.
func BeeMessagesHandler(w http.ResponseWriter, r *http.Request) {
	if !requireAuthenticatedAgentToolUser(w, r) {
		return
	}

	switch r.Method {
	case http.MethodGet:
		ListBeeMessagesHandler(w, r)
	case http.MethodPost:
		CreateBeeMessageHandler(w, r)
	case http.MethodDelete:
		DeleteBeeMessageHandler(w, r)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// ListBeeMessagesHandler returns messages with optional filters.
// Supports: ?id=N (single), ?task_id=N, ?user_id=N, ?thread_id=UUID, ?since=timestamp
func ListBeeMessagesHandler(w http.ResponseWriter, r *http.Request) {
	// Single message by ID
	if idStr := r.URL.Query().Get("id"); idStr != "" {
		id, err := strconv.ParseInt(idStr, 10, 64)
		if err != nil {
			http.Error(w, "Invalid id", http.StatusBadRequest)
			return
		}
		query := "SELECT " + beeMessageColumns + " FROM bee_messages WHERE id = $1"
		row := backend.Db.QueryRow(query, id)
		m, err := scanBeeMessage(row)
		if err != nil {
			http.Error(w, "Message not found", http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(m)
		return
	}

	// List with filters
	query := "SELECT " + beeMessageColumns + " FROM bee_messages"
	args := []interface{}{}
	conditions := []string{}

	if taskIDStr := r.URL.Query().Get("task_id"); taskIDStr != "" {
		taskID, err := strconv.Atoi(taskIDStr)
		if err != nil {
			http.Error(w, "Invalid task_id", http.StatusBadRequest)
			return
		}
		conditions = append(conditions, fmt.Sprintf("task_id = $%d", len(args)+1))
		args = append(args, taskID)
	}

	if userIDStr := r.URL.Query().Get("user_id"); userIDStr != "" {
		userID, err := strconv.Atoi(userIDStr)
		if err != nil {
			http.Error(w, "Invalid user_id", http.StatusBadRequest)
			return
		}
		conditions = append(conditions, fmt.Sprintf("user_id = $%d", len(args)+1))
		args = append(args, userID)
	}

	if threadID := r.URL.Query().Get("thread_id"); threadID != "" {
		conditions = append(conditions, fmt.Sprintf("thread_id = $%d", len(args)+1))
		args = append(args, threadID)
	}

	if since := r.URL.Query().Get("since"); since != "" {
		sinceTime, err := time.Parse(time.RFC3339, since)
		if err != nil {
			http.Error(w, "Invalid since timestamp (use RFC3339)", http.StatusBadRequest)
			return
		}
		conditions = append(conditions, fmt.Sprintf("created >= $%d", len(args)+1))
		args = append(args, sinceTime)
	}

	if len(conditions) > 0 {
		query += " WHERE "
		for i, cond := range conditions {
			if i > 0 {
				query += " AND "
			}
			query += cond
		}
	}
	query += " ORDER BY created ASC, id ASC"

	rows, err := backend.Db.Query(query, args...)
	if err != nil {
		log.Printf("\033[31merror: bee_messages list query failed: %v\033[0m", err)
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	messages := []BeeMessage{}
	for rows.Next() {
		m, err := scanBeeMessage(rows)
		if err != nil {
			log.Printf("\033[31merror: scanning bee_message: %v\033[0m", err)
			continue
		}
		messages = append(messages, m)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(messages)
}

// beeMessageCreateRequest is the expected JSON body for creating a message.
type beeMessageCreateRequest struct {
	Title       *string         `json:"title"`
	Content     json.RawMessage `json:"content"`
	UserID      int             `json:"user_id"`
	TaskID      *int            `json:"task_id"`
	ThreadID    *string         `json:"thread_id"`
	InReplyToID *int64          `json:"in_reply_to_id"`
}

// CreateBeeMessageHandler creates a new bee message.
func CreateBeeMessageHandler(w http.ResponseWriter, r *http.Request) {
	var req beeMessageCreateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	// Validate required fields
	if len(req.Content) == 0 {
		http.Error(w, "content is required", http.StatusBadRequest)
		return
	}
	if req.UserID == 0 {
		http.Error(w, "user_id is required", http.StatusBadRequest)
		return
	}

	// Validate content is valid JSON
	var contentCheck interface{}
	if err := json.Unmarshal(req.Content, &contentCheck); err != nil {
		http.Error(w, "content must be valid JSON", http.StatusBadRequest)
		return
	}

	query := `
		INSERT INTO bee_messages (title, content, user_id, task_id, thread_id, in_reply_to_id)
		VALUES ($1, $2, $3, $4, COALESCE($5::uuid, gen_random_uuid()), $6)
		RETURNING ` + beeMessageColumns

	row := backend.Db.QueryRow(
		query,
		req.Title,
		req.Content,
		req.UserID,
		req.TaskID,
		req.ThreadID,
		req.InReplyToID,
	)

	m, err := scanBeeMessage(row)
	if err != nil {
		log.Printf("\033[31merror: creating bee_message: %v\033[0m", err)
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(m)
}

// DeleteBeeMessageHandler deletes a message by ID (admin use only).
func DeleteBeeMessageHandler(w http.ResponseWriter, r *http.Request) {
	idStr := r.URL.Query().Get("id")
	if idStr == "" {
		http.Error(w, "id is required", http.StatusBadRequest)
		return
	}

	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		http.Error(w, "Invalid id", http.StatusBadRequest)
		return
	}

	result, err := backend.Db.Exec("DELETE FROM bee_messages WHERE id = $1", id)
	if err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		http.Error(w, "Message not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"message": "Message deleted"}`))
}
