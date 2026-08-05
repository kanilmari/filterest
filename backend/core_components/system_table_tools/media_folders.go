// media_folders.go
// HTTP handler for managing the media folder structure.
// Bridges the filesystem media directory and the admin media-management UI.
// Exists to let admins list, create, and delete storage subfolders used by file upload columns.
package system_table_tools

import (
	"easelect/backend/core_components/httpresponse"
	storagecleanup "easelect/backend/core_components/storagecleanup"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_create"
	media_utils "easelect/backend/core_components/media_utils"

	"github.com/lib/pq"
)

const storageRootDir = storagecleanup.StorageRootDir

// CheckMediaTableFoldersHandler lists directories in storage/ that
// don't correspond to any table_uid in system_db_tables.
func CheckMediaTableFoldersHandler(w http.ResponseWriter, r *http.Request) {
	unknownFolders, err := storagecleanup.ListUnknownStorageTableFolders()
	if err != nil {
		log.Printf("\033[31merror: listing unknown storage folders: %v\033[0m", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "error listing unknown storage folders")
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string][]string{"unknown": unknownFolders})
}

// ArchiveMediaTableFoldersHandler moves top-level storage folders without a matching live table_uid into storage_deleted/.
func ArchiveMediaTableFoldersHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "only POST allowed")
		return
	}

	archivedFolders, err := storagecleanup.ArchiveUnknownStorageTableFolders()
	if err != nil {
		log.Printf("\033[31merror: archiving unknown storage folders: %v\033[0m", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "error archiving unknown storage folders")
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"archived": archivedFolders,
		"count":    len(archivedFolders),
	})
}

// CheckArchivedMediaTableFoldersHandler lists top-level storage_deleted folders and whether they are safe to prune.
func CheckArchivedMediaTableFoldersHandler(w http.ResponseWriter, r *http.Request) {
	archivedFolders, err := storagecleanup.ListArchivedStorageTableFolders()
	if err != nil {
		log.Printf("\033[31merror: listing archived storage folders: %v\033[0m", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "error listing archived storage folders")
		return
	}

	prunableFolders := make([]string, 0, len(archivedFolders))
	for _, folder := range archivedFolders {
		if folder.Prunable {
			prunableFolders = append(prunableFolders, folder.FolderName)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"archived":       archivedFolders,
		"prunable":       prunableFolders,
		"count":          len(archivedFolders),
		"prunable_count": len(prunableFolders),
	})
}

// PruneArchivedMediaTableFoldersHandler permanently removes archived top-level dataset folders
// whose table_uid no longer maps to a live dataset.
func PruneArchivedMediaTableFoldersHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "only POST allowed")
		return
	}

	var requestBody struct {
		Folders []string `json:"folders"`
	}
	if err := json.NewDecoder(r.Body).Decode(&requestBody); err != nil && err != io.EOF {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "error decoding prune request")
		return
	}

	prunedFolders, err := storagecleanup.PruneArchivedStorageTableFolders(requestBody.Folders)
	if err != nil {
		log.Printf("\033[31merror: pruning archived storage folders: %v\033[0m", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "error pruning archived storage folders")
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"pruned": prunedFolders,
		"count":  len(prunedFolders),
	})
}

// CheckMediaRowFoldersHandler lists subfolders in storage/<table_uid>
// that don't have a matching row in the given table.
func CheckMediaRowFoldersHandler(w http.ResponseWriter, r *http.Request) {
	table := r.URL.Query().Get("dataset")
	if table == "" {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "table parameter missing")
		return
	}

	var tableUID string
	err := backend.Db.QueryRow(`SELECT table_uid FROM system_db_tables WHERE table_name = $1`, table).Scan(&tableUID)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "table not found")
		return
	}

	base := filepath.Join(storageRootDir, tableUID)
	entries, err := os.ReadDir(base)
	if err != nil {
		if os.IsNotExist(err) {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string][]string{"orphans": {}})
			return
		}
		log.Printf("\033[31merror: reading %s: %v\033[0m", base, err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "error reading storage")
		return
	}

	var orphans []string
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		id, err := strconv.Atoi(e.Name())
		if err != nil {
			continue
		}
		var exists bool
		query := fmt.Sprintf(`SELECT EXISTS (SELECT 1 FROM %s WHERE id = $1)`, pq.QuoteIdentifier(table))
		if err := backend.Db.QueryRow(query, id).Scan(&exists); err != nil {
			log.Printf("\033[31merror: checking row existence: %v\033[0m", err)
			continue
		}
		if !exists {
			orphans = append(orphans, e.Name())
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string][]string{"orphans": orphans})
}

// CheckMediaSubfoldersHandler verifies that each row folder has required subfolders.
func CheckMediaSubfoldersHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "only GET allowed")
		return
	}

	table := r.URL.Query().Get("dataset")
	if table == "" {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "table parameter missing")
		return
	}

	var tableUID string
	err := backend.Db.QueryRow(`SELECT table_uid FROM system_db_tables WHERE table_name = $1`, table).Scan(&tableUID)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "table not found")
		return
	}

	base := filepath.Join(storageRootDir, tableUID)
	entries, err := os.ReadDir(base)
	if err != nil {
		if os.IsNotExist(err) {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string][]struct{}{"rows": {}})
			return
		}
		log.Printf("\033[31merror: reading %s: %v\033[0m", base, err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "error reading storage")
		return
	}

	type missingInfo struct {
		ID      int      `json:"id"`
		Missing []string `json:"missing"`
	}
	var missing []missingInfo
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		id, err := strconv.Atoi(e.Name())
		if err != nil {
			continue
		}
		rowPath := filepath.Join(base, e.Name())
		var miss []string
		for _, sub := range media_utils.RequiredSubfolders {
			info, err := os.Stat(filepath.Join(rowPath, sub))
			if err != nil || !info.IsDir() {
				miss = append(miss, sub)
			}
		}
		if len(miss) > 0 {
			missing = append(missing, missingInfo{ID: id, Missing: miss})
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string][]missingInfo{"rows": missing})
}

// FixMediaSubfoldersHandler ensures required subfolders and thumbnails exist for each media row.
func FixMediaSubfoldersHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "only POST allowed")
		return
	}

	table := r.URL.Query().Get("dataset")
	if table == "" {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "table parameter missing")
		return
	}

	var tableUID string
	err := backend.Db.QueryRow(`SELECT table_uid FROM system_db_tables WHERE table_name = $1`, table).Scan(&tableUID)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "table not found")
		return
	}

	base := filepath.Join(storageRootDir, tableUID)
	entries, err := os.ReadDir(base)
	if err != nil {
		if os.IsNotExist(err) {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string][]struct{}{"rows": {}})
			return
		}
		log.Printf("\033[31merror: reading %s: %v\033[0m", base, err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "error reading storage")
		return
	}

	type fixInfo struct {
		ID    int      `json:"id"`
		Fixed []string `json:"fixed"`
	}
	var results []fixInfo

	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		id, err := strconv.Atoi(e.Name())
		if err != nil {
			continue
		}
		rowPath := filepath.Join(base, e.Name())
		var fixes []string

		// Ensure required subfolders exist
		for _, sub := range media_utils.RequiredSubfolders {
			subPath := filepath.Join(rowPath, sub)
			if _, err := os.Stat(subPath); os.IsNotExist(err) {
				if err := os.MkdirAll(subPath, 0755); err != nil {
					log.Printf("\033[31merror: creating %s: %v\033[0m", subPath, err)
					continue
				}
				fixes = append(fixes, fmt.Sprintf("created folder %s", sub))
			}
		}

		// Move files from root into original
		entriesRoot, err := os.ReadDir(rowPath)
		if err == nil {
			for _, f := range entriesRoot {
				if f.IsDir() {
					continue
				}
				oldPath := filepath.Join(rowPath, f.Name())
				newPath := filepath.Join(rowPath, "original", f.Name())
				if err := os.Rename(oldPath, newPath); err != nil {
					log.Printf("\033[31merror: moving %s: %v\033[0m", oldPath, err)
					continue
				}
				fixes = append(fixes, fmt.Sprintf("moved %s to original", f.Name()))
			}
		}

		// Generate thumbnails for originals
		originals, err := os.ReadDir(filepath.Join(rowPath, "original"))
		if err != nil {
			log.Printf("\033[31merror: reading originals in %s: %v\033[0m", rowPath, err)
			continue
		}
		for _, orig := range originals {
			if orig.IsDir() {
				continue
			}
			ext := strings.ToLower(filepath.Ext(orig.Name()))
			if _, ok := media_utils.AllowedImageExtensions[ext]; !ok {
				continue
			}
			origPath := filepath.Join(rowPath, "original", orig.Name())
			for _, sub := range media_utils.RequiredSubfolders {
				if sub == "original" {
					continue
				}
				destPath := filepath.Join(rowPath, sub, orig.Name())
				if _, err := os.Stat(destPath); err == nil {
					continue
				}
				size, err := strconv.Atoi(sub)
				if err != nil {
					continue
				}
				if err := dtt_1_row_create.ResizeImageMaxDimension(origPath, destPath, size); err != nil {
					log.Printf("\033[31merror: resizing %s -> %s: %v\033[0m", origPath, destPath, err)
					continue
				}
				fixes = append(fixes, fmt.Sprintf("generated %s for %s", sub, orig.Name()))
			}
		}

		if len(fixes) > 0 {
			results = append(results, fixInfo{ID: id, Fixed: fixes})
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string][]fixInfo{"rows": results})
}
