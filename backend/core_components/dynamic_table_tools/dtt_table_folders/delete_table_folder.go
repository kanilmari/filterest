// delete_table_folder.go
// HTTP handler for deleting a folder from the table folder tree. Validates the request and
// removes the folder node and its associations from the database.
// Exists to keep folder deletion guarded against orphaned child folders or datasets.
package dtt_system_table_folders

import (
	"easelect/backend/core_components/httpresponse"
	"easelect/backend/core_components/lang"
	"encoding/json"
	"fmt"
	"log"
	"net/http"

	backend "easelect/backend/core_components"
)

// HandleDeleteFolder käsittelee POST /api/delete-folder
// Body: { "folder_id": 123 }
// Poistaa kansion vain jos:
//  1. Kansiolla ei ole lapsikansioita (system_table_folders.parent_id = folder_id)
//  2. Kansiossa ei ole tauluja (system_db_tables.folder_id = folder_id)
func HandleDeleteFolder(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var req struct {
		FolderID int `json:"folder_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid json")
		return
	}

	if req.FolderID <= 0 {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "folder_id is required and must be positive")
		return
	}

	fmt.Printf("[HandleDeleteFolder] folder_id=%d\n", req.FolderID)

	// Tarkistetaan, että kansio on olemassa
	var folderName string
	err := backend.Db.QueryRow("SELECT folder_name FROM system_table_folders WHERE id = $1", req.FolderID).Scan(&folderName)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusNotFound, fmt.Sprintf("folder %d not found", req.FolderID))
		return
	}

	// Tarkistetaan, onko kansiossa lapsikansioita
	var childFolderCount int
	backend.Db.QueryRow("SELECT COUNT(*) FROM system_table_folders WHERE parent_id = $1", req.FolderID).Scan(&childFolderCount)
	if childFolderCount > 0 {
		httpresponse.RespondWithError(w, http.StatusConflict, fmt.Sprintf("folder '%s' has %d child folder(s) — only empty folders can be deleted", folderName, childFolderCount))
		return
	}

	// Tarkistetaan, onko kansiossa tauluja
	var tableCount int
	backend.Db.QueryRow("SELECT COUNT(*) FROM system_db_tables WHERE folder_id = $1", req.FolderID).Scan(&tableCount)
	if tableCount > 0 {
		httpresponse.RespondWithError(w, http.StatusConflict, fmt.Sprintf("folder '%s' has %d table(s) — only empty folders can be deleted", folderName, tableCount))
		return
	}

	// Kansio on tyhjä — poistetaan
	_, err = backend.Db.Exec("DELETE FROM system_table_folders WHERE id = $1", req.FolderID)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("db error deleting folder: %v", err))
		return
	}

	// Siivoton kansion kieliavainlähteet ja orpoavaimet
	if cleanErr := lang.CleanupLangKeySourcesForFolder(backend.Db, folderName); cleanErr != nil {
		log.Printf("[HandleDeleteFolder] warning: lang key source cleanup for folder '%s': %v", folderName, cleanErr)
		// Non-fatal: folder is already deleted, metadata cleanup is best-effort.
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"message":     fmt.Sprintf("Folder '%s' deleted successfully.", folderName),
		"folder_id":   req.FolderID,
		"folder_name": folderName,
	})
}
