// current_project_folder_handler.go
// HTTP handler for changing which project root folder is active in the admin UI.
// Bridges an explicit admin action and the system_table_folders.is_current_project flag.
// Exists so project switching can happen through Easelect itself instead of helper scripts.

package dtt_system_table_folders

import (
	"easelect/backend/core_components/httpresponse"
	"encoding/json"
	"fmt"
	"net/http"

	backend "easelect/backend/core_components"
)

type setCurrentProjectFolderRequest struct {
	FolderID int `json:"folder_id"`
}

func decodeSetCurrentProjectFolderRequest(r *http.Request) (setCurrentProjectFolderRequest, error) {
	var req setCurrentProjectFolderRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		return setCurrentProjectFolderRequest{}, err
	}
	return req, nil
}

func validateSetCurrentProjectFolderRequest(req setCurrentProjectFolderRequest) error {
	if req.FolderID <= 0 {
		return fmt.Errorf("folder_id must be positive")
	}
	return nil
}

// HandleSetCurrentProjectFolder handles POST /api/set-current-project-folder and marks
// one project-root folder under Apps as the active current project.
func HandleSetCurrentProjectFolder(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	req, err := decodeSetCurrentProjectFolderRequest(r)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid json")
		return
	}
	if err := validateSetCurrentProjectFolderRequest(req); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
		return
	}

	scope, err := resolveProjectFolderScope(req.FolderID)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("db error resolving project scope: %v", err))
		return
	}
	if scope.RootFolderID == nil || !scope.IsTopLevel || *scope.RootFolderID != req.FolderID {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "folder_id must reference a project root folder directly under Apps")
		return
	}

	tx, err := backend.Db.Begin()
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("db error starting current-project transaction: %v", err))
		return
	}
	defer func() {
		_ = tx.Rollback()
	}()

	if _, err := tx.Exec(`
		UPDATE system_table_folders
		SET is_current_project = false
		WHERE is_current_project = true
	`); err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("db error clearing previous current project: %v", err))
		return
	}

	result, err := tx.Exec(`
		UPDATE system_table_folders
		SET is_current_project = true
		WHERE id = $1
	`, req.FolderID)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("db error setting current project: %v", err))
		return
	}
	rowsAffected, err := result.RowsAffected()
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("rows affected error updating current project: %v", err))
		return
	}
	if rowsAffected == 0 {
		httpresponse.RespondWithError(w, http.StatusNotFound, "project folder not found")
		return
	}
	if err := tx.Commit(); err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("db error committing current project change: %v", err))
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"status":       "ok",
		"message":      "Current project updated.",
		"project_name": scope.RootFolderName,
	})
}
