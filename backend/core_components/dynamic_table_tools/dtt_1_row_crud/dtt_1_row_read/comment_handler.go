// comment_handler.go
// CRUD endpoints for the generic system_comments table (list, create, delete).
// Bridges the cross-table comment store and the frontend comment UI with self-managed auth.
// Exists to provide polymorphic commenting across all datasets without table-specific pipeline rules.

package dtt_1_row_read

import (
	backend "easelect/backend/core_components"
	"easelect/backend/core_components/httpresponse"
	e_sessions "easelect/backend/core_components/sessions"
	"encoding/json"
	"log"
	"net/http"
	"strconv"
)

const commentsPageSize = 50

// Comments are polymorphic across datasets, so these handlers do their own auth checks.
// Table-specific pipeline access control cannot answer cross-table ownership questions here.

// CommentListHandler handles GET /api/comments
func CommentListHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	dataset := r.URL.Query().Get("dataset")
	rowIDStr := r.URL.Query().Get("row_id")
	pageStr := r.URL.Query().Get("page")

	if dataset == "" || rowIDStr == "" {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "dataset and row_id are required")
		return
	}

	rowID, err := strconv.Atoi(rowIDStr)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "row_id must be an integer")
		return
	}

	page := 1
	if pageStr != "" {
		if p, err := strconv.Atoi(pageStr); err == nil && p > 0 {
			page = p
		}
	}
	offset := (page - 1) * commentsPageSize

	// Count total
	var total int
	err = backend.Db.QueryRow(
		"SELECT COUNT(*) FROM system_comments WHERE table_name = $1 AND row_id = $2",
		dataset, rowID,
	).Scan(&total)
	if err != nil {
		log.Printf("\033[31merror: counting comments: %s\033[0m", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "error counting comments")
		return
	}

	// Fetch page
	rows, err := backend.Db.Query(`
		SELECT sc.id, sc.comment_text, sc.created_by, COALESCE(su.username, ''), sc.created
		FROM system_comments sc
		LEFT JOIN system_users su ON su.id = sc.created_by
		WHERE sc.table_name = $1 AND sc.row_id = $2
		ORDER BY sc.created DESC
		LIMIT $3 OFFSET $4`,
		dataset, rowID, commentsPageSize, offset,
	)
	if err != nil {
		log.Printf("\033[31merror: fetching comments: %s\033[0m", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "error fetching comments")
		return
	}
	defer rows.Close()

	type CommentRow struct {
		ID          int    `json:"id"`
		CommentText string `json:"comment_text"`
		CreatedBy   *int   `json:"created_by"`
		Username    string `json:"username"`
		Created     string `json:"created"`
	}

	var comments []CommentRow
	for rows.Next() {
		var c CommentRow
		var createdBy int
		var created interface{}
		if err := rows.Scan(&c.ID, &c.CommentText, &createdBy, &c.Username, &created); err != nil {
			log.Printf("\033[31merror: scanning comment row: %s\033[0m", err)
			continue
		}
		c.CreatedBy = &createdBy
		if t, ok := created.(interface{ Format(string) string }); ok {
			c.Created = t.Format("2006-01-02T15:04:05Z07:00")
		}
		comments = append(comments, c)
	}

	if comments == nil {
		comments = []CommentRow{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"comments": comments,
		"total":    total,
	})
}

// CommentCreateHandler handles POST /api/comments
func CommentCreateHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	userID, err := e_sessions.GetUserIDFromSession(r)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusUnauthorized, "not authenticated")
		return
	}

	var body struct {
		Dataset     string `json:"dataset"`
		RowID       int    `json:"row_id"`
		CommentText string `json:"comment_text"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if body.Dataset == "" || body.RowID == 0 || body.CommentText == "" {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "dataset, row_id, and comment_text are required")
		return
	}

	if len(body.CommentText) > 5000 {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "comment_text exceeds 5000 characters")
		return
	}

	var newID int
	err = backend.Db.QueryRow(`
		INSERT INTO system_comments (table_name, row_id, comment_text, created_by)
		VALUES ($1, $2, $3, $4) RETURNING id`,
		body.Dataset, body.RowID, body.CommentText, userID,
	).Scan(&newID)
	if err != nil {
		log.Printf("\033[31merror: inserting comment: %s\033[0m", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "error creating comment")
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"id":      newID,
		"success": true,
	})
}

// CommentDeleteHandler handles DELETE /api/comments?id=N
func CommentDeleteHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	userID, err := e_sessions.GetUserIDFromSession(r)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusUnauthorized, "not authenticated")
		return
	}

	commentIDStr := r.URL.Query().Get("id")
	if commentIDStr == "" {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "id is required")
		return
	}
	commentID, err := strconv.Atoi(commentIDStr)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "id must be an integer")
		return
	}

	// Check ownership or admin
	var createdBy int
	err = backend.Db.QueryRow(
		"SELECT created_by FROM system_comments WHERE id = $1", commentID,
	).Scan(&createdBy)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusNotFound, "comment not found")
		return
	}

	isAdmin := isAdminUser(r)
	if createdBy != userID && !isAdmin {
		httpresponse.RespondWithError(w, http.StatusForbidden, "can only delete own comments")
		return
	}

	_, err = backend.Db.Exec("DELETE FROM system_comments WHERE id = $1", commentID)
	if err != nil {
		log.Printf("\033[31merror: deleting comment: %s\033[0m", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "error deleting comment")
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
}

// isAdminUser checks if the session user has admin role.
func isAdminUser(r *http.Request) bool {
	store := e_sessions.GetStore()
	session, err := store.Get(r, e_sessions.SessionName)
	if err != nil {
		return false
	}
	role, ok := session.Values["user_role"].(string)
	return ok && role == "admin"
}
