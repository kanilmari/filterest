// update_table_folders.go
// HTTP handlers for moving folders and tables inside the admin navigation tree.
// Bridges drag-and-drop requests and the system_table_folders/system_db_tables
// metadata rows that persist folder assignments.
// Exists so folder moves can stay tableless while table moves use a dataset-bound permission path.

package dtt_system_table_folders

import (
	"database/sql"
	"easelect/backend/core_components/httpresponse"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	backend "easelect/backend/core_components"
)

type updateFolderRequest struct {
	ItemID                     int    `json:"item_id"`
	ItemType                   string `json:"item_type"`
	NewFolderID                int    `json:"new_folder_id"`
	DatasetUID                 int    `json:"dataset_uid"`
	ConfirmCrossProjectMove    bool   `json:"confirm_cross_project_move"`
	ConfirmTabVisibilityChange bool   `json:"confirm_tab_visibility_change"`
}

func decodeUpdateFolderRequest(r *http.Request) (updateFolderRequest, error) {
	var req updateFolderRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		return updateFolderRequest{}, err
	}
	return req, nil
}

func normalizedItemType(itemType string) string {
	return strings.ToLower(strings.TrimSpace(itemType))
}

func validateFolderMoveRequest(req updateFolderRequest) error {
	if req.ItemID <= 0 {
		return fmt.Errorf("item_id must be positive")
	}
	if req.NewFolderID <= 0 {
		return fmt.Errorf("new_folder_id must be positive")
	}
	if normalizedItemType(req.ItemType) != "folder" {
		return fmt.Errorf("item_type must be 'folder'")
	}
	return nil
}

func validateTableMoveRequest(req updateFolderRequest) error {
	if req.ItemID <= 0 {
		return fmt.Errorf("item_id must be positive")
	}
	if req.NewFolderID <= 0 {
		return fmt.Errorf("new_folder_id must be positive")
	}
	if normalizedItemType(req.ItemType) != "table" {
		return fmt.Errorf("item_type must be 'table'")
	}
	if req.DatasetUID <= 0 {
		return fmt.Errorf("dataset_uid must be positive")
	}
	return nil
}

type projectFolderScope struct {
	RootFolderID   *int
	RootFolderName string
	IsTopLevel     bool
}

type tableLocation struct {
	Name     string
	FolderID *int
}

func resolveProjectFolderScope(folderID int) (projectFolderScope, error) {
	scope := projectFolderScope{}

	var rootID int
	var rootName string
	err := backend.Db.QueryRow(`
		WITH RECURSIVE folder_ancestors AS (
			SELECT id, parent_id, folder_name, 0 AS depth
			FROM system_table_folders
			WHERE id = $1
			UNION ALL
			SELECT parent.id, parent.parent_id, parent.folder_name, folder_ancestors.depth + 1
			FROM system_table_folders parent
			INNER JOIN folder_ancestors ON folder_ancestors.parent_id = parent.id
		)
		SELECT folder_ancestors.id, folder_ancestors.folder_name
		FROM folder_ancestors
		INNER JOIN system_table_folders container
			ON folder_ancestors.parent_id = container.id
		WHERE LOWER(container.folder_name) IN ('apps', 'app_projects')
		ORDER BY folder_ancestors.depth ASC
		LIMIT 1
	`, folderID).Scan(&rootID, &rootName)
	if err == sql.ErrNoRows {
		return scope, nil
	}
	if err != nil {
		return scope, err
	}

	scope.RootFolderID = &rootID
	scope.RootFolderName = rootName
	scope.IsTopLevel = rootID == folderID
	return scope, nil
}

func fetchTableLocation(itemID int, datasetUID int) (tableLocation, error) {
	location := tableLocation{}
	var folderID sql.NullInt64
	if err := backend.Db.QueryRow(`
		SELECT table_name, folder_id
		FROM system_db_tables
		WHERE id = $1
		  AND table_uid = $2
	`, itemID, datasetUID).Scan(&location.Name, &folderID); err != nil {
		return tableLocation{}, err
	}
	if folderID.Valid {
		parsedFolderID := int(folderID.Int64)
		location.FolderID = &parsedFolderID
	}
	return location, nil
}

func sameProjectRoot(source *int, target *int) bool {
	if source == nil && target == nil {
		return true
	}
	if source == nil || target == nil {
		return false
	}
	return *source == *target
}

func buildCrossProjectMoveMessage(itemType string, itemName string, sourceProject string, targetProject string) string {
	displayType := strings.TrimSpace(itemType)
	if displayType == "" {
		displayType = "item"
	}
	if sourceProject != "" && targetProject != "" {
		return fmt.Sprintf("Confirm moving %s %q from project %q to project %q first.", displayType, itemName, sourceProject, targetProject)
	}
	if sourceProject != "" {
		return fmt.Sprintf("Confirm moving %s %q out of project %q first.", displayType, itemName, sourceProject)
	}
	if targetProject != "" {
		return fmt.Sprintf("Confirm moving %s %q into project %q first.", displayType, itemName, targetProject)
	}
	return fmt.Sprintf("Confirm moving %s %q across project boundaries first.", displayType, itemName)
}

func buildTopTabVisibilityMessage(tableName string, willBecomeVisible bool) string {
	if willBecomeVisible {
		return fmt.Sprintf("Confirm moving table %q into the project root first. It will appear in the project's main SVG tabs.", tableName)
	}
	return fmt.Sprintf("Confirm moving table %q into a project subfolder first. It will stay in the project but disappear from the project's main SVG tabs.", tableName)
}

// HandleUpdateFolder handles POST /api/update-folder for moving folders under another folder.
// Body: { "item_id": 123, "item_type": "folder", "new_folder_id": 456 }
func HandleUpdateFolder(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	req, err := decodeUpdateFolderRequest(r)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid json")
		return
	}
	if err := validateFolderMoveRequest(req); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
		return
	}

	fmt.Printf("[handleUpdateFolder] item_id=%d, item_type=%s, new_folder_id=%d\n",
		req.ItemID, req.ItemType, req.NewFolderID)

	sourceScope, err := resolveProjectFolderScope(req.ItemID)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("db error resolving source folder scope: %v", err))
		return
	}
	targetScope, err := resolveProjectFolderScope(req.NewFolderID)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("db error resolving target folder scope: %v", err))
		return
	}
	if !sameProjectRoot(sourceScope.RootFolderID, targetScope.RootFolderID) && !req.ConfirmCrossProjectMove {
		httpresponse.RespondWithError(w, http.StatusConflict, buildCrossProjectMoveMessage("folder", fmt.Sprintf("%d", req.ItemID), sourceScope.RootFolderName, targetScope.RootFolderName))
		return
	}

	result, err := backend.Db.Exec(`
        UPDATE system_table_folders
           SET parent_id = $1
         WHERE id = $2
    `, req.NewFolderID, req.ItemID)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("db error updating folder: %v", err))
		return
	}
	rowsAffected, err := result.RowsAffected()
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("rows affected error updating folder: %v", err))
		return
	}
	if rowsAffected != 1 {
		httpresponse.RespondWithError(w, http.StatusNotFound, fmt.Sprintf("folder %d not found", req.ItemID))
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]string{"message": "Folder updated successfully."})
}

// HandleUpdateTableFolder handles POST /api/update-table-folder for moving a table into a folder.
// Body: { "item_id": 123, "item_type": "table", "dataset_uid": 456, "new_folder_id": 789 }
func HandleUpdateTableFolder(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	req, err := decodeUpdateFolderRequest(r)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid json")
		return
	}
	if err := validateTableMoveRequest(req); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
		return
	}

	fmt.Printf("[HandleUpdateTableFolder] item_id=%d, dataset_uid=%d, new_folder_id=%d\n",
		req.ItemID, req.DatasetUID, req.NewFolderID)

	currentLocation, err := fetchTableLocation(req.ItemID, req.DatasetUID)
	if err == sql.ErrNoRows {
		httpresponse.RespondWithError(w, http.StatusNotFound, "table not found for provided dataset_uid")
		return
	}
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("db error fetching current table location: %v", err))
		return
	}

	sourceScope := projectFolderScope{}
	if currentLocation.FolderID != nil {
		sourceScope, err = resolveProjectFolderScope(*currentLocation.FolderID)
		if err != nil {
			httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("db error resolving source table scope: %v", err))
			return
		}
	}

	targetScope, err := resolveProjectFolderScope(req.NewFolderID)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("db error resolving target table scope: %v", err))
		return
	}

	crossProjectMove := !sameProjectRoot(sourceScope.RootFolderID, targetScope.RootFolderID)
	if crossProjectMove && !req.ConfirmCrossProjectMove {
		httpresponse.RespondWithError(w, http.StatusConflict, buildCrossProjectMoveMessage("table", currentLocation.Name, sourceScope.RootFolderName, targetScope.RootFolderName))
		return
	}

	changesTopTabVisibility := !crossProjectMove &&
		(sourceScope.RootFolderID != nil || targetScope.RootFolderID != nil) &&
		sourceScope.IsTopLevel != targetScope.IsTopLevel
	if changesTopTabVisibility && !req.ConfirmTabVisibilityChange {
		httpresponse.RespondWithError(w, http.StatusConflict, buildTopTabVisibilityMessage(currentLocation.Name, targetScope.IsTopLevel))
		return
	}

	// Bind the moved row to both id and table_uid so the caller cannot authorize
	// against one dataset and then move another table by numeric id.
	result, err := backend.Db.Exec(`
        UPDATE system_db_tables
           SET folder_id = $1
         WHERE id = $2
           AND table_uid = $3
    `, req.NewFolderID, req.ItemID, req.DatasetUID)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("db error updating system_db_tables: %v", err))
		return
	}
	rowsAffected, err := result.RowsAffected()
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("rows affected error updating system_db_tables: %v", err))
		return
	}
	if rowsAffected != 1 {
		httpresponse.RespondWithError(w, http.StatusNotFound, "table not found for provided dataset_uid")
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]string{"message": "Table updated successfully."})
}
