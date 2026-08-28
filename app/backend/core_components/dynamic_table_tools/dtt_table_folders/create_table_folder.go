// create_table_folder.go
// HTTP handler for creating a new folder in the table folder tree. Validates the request and
// inserts the folder node into the tree structure stored in the database.
// Exists to let admins organize datasets without bypassing folder-tree validation.
package dtt_system_table_folders

import (
	"database/sql"
	"easelect/backend/core_components/httpresponse"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
)

type CreateFolderRequest struct {
	FolderName string `json:"folder_name"`
	ParentID   *int   `json:"parent_id"`
}

const (
	DatabaseFolderName    = "database"
	OtherTablesFolderName = "other_tables"
)

func normalizeCreateFolderRequest(req CreateFolderRequest) (CreateFolderRequest, error) {
	req.FolderName = strings.TrimSpace(req.FolderName)
	if req.FolderName == "" {
		return CreateFolderRequest{}, fmt.Errorf("folder_name is required")
	}
	if req.ParentID != nil && *req.ParentID <= 0 {
		req.ParentID = nil
	}
	return req, nil
}

func EnsureFolderExists(q dbutils.Querier, parentID int) error {
	var parentExists bool
	if err := q.QueryRow("SELECT EXISTS(SELECT 1 FROM system_table_folders WHERE id = $1)", parentID).Scan(&parentExists); err != nil {
		return fmt.Errorf("failed to validate parent folder %d: %w", parentID, err)
	}
	if !parentExists {
		return fmt.Errorf("parent folder %d not found", parentID)
	}
	return nil
}

func EnsureRootFolderByName(q dbutils.Querier, folderName string) (int, error) {
	normalizedName := strings.TrimSpace(folderName)
	if normalizedName == "" {
		return 0, fmt.Errorf("folder_name is required")
	}

	var folderID int
	err := q.QueryRow(`
		SELECT id
		FROM system_table_folders
		WHERE parent_id IS NULL
		  AND folder_name = $1
		ORDER BY id
		LIMIT 1
	`, normalizedName).Scan(&folderID)
	if err == nil {
		return folderID, nil
	}
	if err != nil && err != sql.ErrNoRows {
		return 0, fmt.Errorf("failed to look up root folder %q: %w", normalizedName, err)
	}

	return CreateFolderWithQuerier(q, CreateFolderRequest{
		FolderName: normalizedName,
		ParentID:   nil,
	})
}

// EnsureFolderPathByName resolves a folder path segment by segment and creates
// any missing child folder beneath the resolved parent instead of creating an
// accidental duplicate root folder.
func EnsureFolderPathByName(q dbutils.Querier, folderPath ...string) (int, error) {
	if len(folderPath) == 0 {
		return 0, fmt.Errorf("folder path is required")
	}

	currentFolderID, err := EnsureRootFolderByName(q, folderPath[0])
	if err != nil {
		return 0, err
	}

	for _, folderName := range folderPath[1:] {
		currentFolderID, err = ensureChildFolderByName(q, currentFolderID, folderName)
		if err != nil {
			return 0, err
		}
	}

	return currentFolderID, nil
}

// EnsureDatabaseOtherTablesFolder keeps auto-grouped internal tables under the
// canonical database -> other_tables path used by the navigation tree.
func EnsureDatabaseOtherTablesFolder(q dbutils.Querier) (int, error) {
	return EnsureFolderPathByName(q, DatabaseFolderName, OtherTablesFolderName)
}

func ensureChildFolderByName(q dbutils.Querier, parentID int, folderName string) (int, error) {
	normalizedName := strings.TrimSpace(folderName)
	if normalizedName == "" {
		return 0, fmt.Errorf("folder_name is required")
	}

	var folderID int
	err := q.QueryRow(`
		SELECT id
		FROM system_table_folders
		WHERE parent_id = $1
		  AND folder_name = $2
		ORDER BY id
		LIMIT 1
	`, parentID, normalizedName).Scan(&folderID)
	if err == nil {
		return folderID, nil
	}
	if err != nil && err != sql.ErrNoRows {
		return 0, fmt.Errorf("failed to look up child folder %q under parent %d: %w", normalizedName, parentID, err)
	}

	return CreateFolderWithQuerier(q, CreateFolderRequest{
		FolderName: normalizedName,
		ParentID:   &parentID,
	})
}

func CreateFolderWithQuerier(q dbutils.Querier, req CreateFolderRequest) (int, error) {
	normalized, err := normalizeCreateFolderRequest(req)
	if err != nil {
		return 0, err
	}

	fmt.Printf("[CreateFolderWithQuerier] folder_name=%s, parent_id=%v\n", normalized.FolderName, normalized.ParentID)

	var newID int
	if normalized.ParentID != nil {
		if err := EnsureFolderExists(q, *normalized.ParentID); err != nil {
			return 0, err
		}
		err = q.QueryRow(`
			INSERT INTO system_table_folders (folder_name, parent_id, created, updated)
			VALUES ($1, $2, NOW(), NOW())
			RETURNING id
		`, normalized.FolderName, *normalized.ParentID).Scan(&newID)
	} else {
		err = q.QueryRow(`
			INSERT INTO system_table_folders (folder_name, parent_id, created, updated)
			VALUES ($1, NULL, NOW(), NOW())
			RETURNING id
		`, normalized.FolderName).Scan(&newID)
	}
	if err != nil {
		return 0, fmt.Errorf("db error creating folder: %w", err)
	}

	return newID, nil
}

// HandleCreateFolder käsittelee POST /api/create-folder
// Body: { "folder_name": "Uusi kansio", "parent_id": 0 }
// parent_id=0 tai puuttuu → juuri (NULL)
func HandleCreateFolder(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var req struct {
		FolderName string `json:"folder_name"`
		ParentID   *int   `json:"parent_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid json")
		return
	}

	newID, err := CreateFolderWithQuerier(backend.Db, CreateFolderRequest{
		FolderName: req.FolderName,
		ParentID:   req.ParentID,
	})
	if err != nil {
		statusCode := http.StatusInternalServerError
		if strings.Contains(err.Error(), "folder_name is required") || strings.Contains(err.Error(), "parent folder") {
			statusCode = http.StatusBadRequest
		}
		httpresponse.RespondWithError(w, statusCode, err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"message":   "Folder created successfully.",
		"folder_id": newID,
	})
}
