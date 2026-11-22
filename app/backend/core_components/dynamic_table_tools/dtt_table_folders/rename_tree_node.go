// rename_tree_node.go
// HTTP handler for renaming a node (table or folder) in the table tree.
// Between the rename dialog and the registry, it renames the item and has the language component
// move the item's label in the same transaction. Exists to coordinate technical names, labels,
// aliases and folder metadata without rewriting a language key other items share.
package dtt_system_table_folders

import (
	"database/sql"
	"easelect/backend/core_components/dataset_routes"
	"easelect/backend/core_components/dynamic_table_tools/dtt_triggers/automation_metadata"
	"easelect/backend/core_components/httpresponse"
	"easelect/backend/core_components/lang"
	"easelect/backend/core_components/runtime_grant_mutations"
	"easelect/backend/core_components/security"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"

	"github.com/lib/pq"
)

// RenameTreeNodeRequest is the body of POST /api/rename-tree-node.
// Translations and ShownTranslations accept fi, en and ch only; see lang.ItemLabelRename.
type RenameTreeNodeRequest struct {
	ItemID       int               `json:"item_id"`
	ItemType     string            `json:"item_type"`    // "folder" or "table"
	NewName      string            `json:"new_name"`     // new technical name, which is also the label's language key
	Translations map[string]string `json:"translations"` // typed label text; blank leaves a language as it is
	// ShownTranslations is the text the dialog displayed when it opened. A language left as shown
	// is not written, and a key whose text changed meanwhile is refused instead of overwritten.
	ShownTranslations map[string]string `json:"shown_translations,omitempty"`
}

// HandleRenameTreeNode käsittelee POST /api/rename-tree-node
func HandleRenameTreeNode(w http.ResponseWriter, r *http.Request) {

	var req RenameTreeNodeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid json")
		return
	}

	req.NewName = strings.TrimSpace(req.NewName)
	if req.NewName == "" {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "new_name is required")
		return
	}
	if req.ItemID <= 0 {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "item_id must be positive")
		return
	}

	log.Printf("[HandleRenameTreeNode] item_id=%d, item_type=%s, new_name=%s, translations=%v\n",
		req.ItemID, req.ItemType, req.NewName, req.Translations)

	mutation, err := runtime_grant_mutations.Begin(r.Context(), w)
	if err != nil {
		runtime_grant_mutations.RespondError(w, err)
		return
	}
	tx := mutation.Tx
	if strings.EqualFold(req.ItemType, "table") {
		if err := dataset_routes.LockDatasetNamespace(tx); err != nil {
			if dataset_routes.RespondNamespaceRefusal(w, err) {
				return
			}
			httpresponse.RespondWithError(w, 500, "error locking dataset namespace")
			return
		}
	}

	var label lang.ItemLabelOutcome
	switch strings.ToLower(req.ItemType) {
	case "folder":
		if label, err = renameFolder(tx, req); err != nil {
			log.Printf("\033[31m[HandleRenameTreeNode] folder error: %v\033[0m\n", err)
			if respondLabelRefusal(w, err) {
				return
			}
			httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("error renaming folder: %v", err))
			return
		}
	case "table":
		if err := mutation.IncludeRows(r.Context(), "system_db_tables", int64(req.ItemID)); err != nil {
			runtime_grant_mutations.RespondError(w, err)
			return
		}
		if label, err = renameTable(tx, req); err != nil {
			log.Printf("\033[31m[HandleRenameTreeNode] table error: %v\033[0m\n", err)
			if dataset_routes.RespondNamespaceRefusal(w, err) || respondLabelRefusal(w, err) {
				return
			}
			httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("error renaming table: %v", err))
			return
		}
	default:
		httpresponse.RespondWithError(w, http.StatusBadRequest, "item_type must be 'folder' or 'table'")
		return
	}

	if err := mutation.Finish(r.Context()); err != nil {
		runtime_grant_mutations.RespondError(w, err)
		return
	}

	response := map[string]interface{}{"message": "Renamed successfully."}
	if len(label.KeptLanguages) > 0 {
		// The new name's key already existed and is shared: the dialog's text for these
		// languages was not saved, and the dialog tells the person so.
		response["label_kept"] = map[string]interface{}{"lang_key": label.LangKey, "languages": label.KeptLanguages}
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(response)
}

// respondLabelRefusal answers a label request the language component refused before writing:
// 400 for an unsupported language, 409 for text that would replace a text the dialog did not show.
// The non-2xx status rolls the whole rename back, the physical table rename included.
func respondLabelRefusal(w http.ResponseWriter, err error) bool {
	switch {
	case errors.Is(err, lang.ErrInvalidItemLabelRename):
		httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
	case errors.Is(err, lang.ErrItemLabelConflict):
		httpresponse.RespondWithError(w, http.StatusConflict, err.Error())
	default:
		return false
	}
	return true
}

// itemLabelRename builds the language component's request for one renamed item.
func itemLabelRename(req RenameTreeNodeRequest, sourceType, oldName, newName string) lang.ItemLabelRename {
	return lang.ItemLabelRename{
		SourceType:   sourceType,
		OldKey:       oldName,
		NewKey:       newName,
		Translations: req.Translations,
		Shown:        req.ShownTranslations,
	}
}

// renameFolder renames a folder and moves its label to the key of the new name.
// Folder names may repeat, so a name another folder still has keeps its key association.
func renameFolder(tx *sql.Tx, req RenameTreeNodeRequest) (lang.ItemLabelOutcome, error) {
	var oldName string
	if err := tx.QueryRow("SELECT folder_name FROM system_table_folders WHERE id = $1", req.ItemID).Scan(&oldName); err != nil {
		return lang.ItemLabelOutcome{}, fmt.Errorf("folder not found (id=%d): %w", req.ItemID, err)
	}

	if _, err := tx.Exec("UPDATE system_table_folders SET folder_name = $1, updated = NOW() WHERE id = $2",
		req.NewName, req.ItemID); err != nil {
		return lang.ItemLabelOutcome{}, fmt.Errorf("update folder_name: %w", err)
	}

	var oldNameStillUsed bool
	if oldName != req.NewName {
		if err := tx.QueryRow("SELECT EXISTS (SELECT 1 FROM system_table_folders WHERE folder_name = $1 AND id <> $2)",
			oldName, req.ItemID).Scan(&oldNameStillUsed); err != nil {
			return lang.ItemLabelOutcome{}, fmt.Errorf("check other folders named %q: %w", oldName, err)
		}
	}

	rename := itemLabelRename(req, "folder", oldName, req.NewName)
	rename.KeepOldSource = oldNameStillUsed
	label, err := lang.MoveRenamedItemLabel(tx, rename)
	if err != nil {
		return lang.ItemLabelOutcome{}, fmt.Errorf("move folder label: %w", err)
	}

	// The source rewrite renames every folder source of the old name, so it runs only when
	// no other folder keeps that name.
	if oldName != req.NewName && !oldNameStillUsed {
		if cleanErr := lang.UpdateLangKeySourcesForFolderRename(tx, oldName, req.NewName); cleanErr != nil {
			return lang.ItemLabelOutcome{}, fmt.Errorf("update folder label associations: %w", cleanErr)
		}
	}

	return label, nil
}

// renameTable renames the PostgreSQL table, its registry row and automation endpoints, then
// moves the dataset's label to the key of the new name and rewrites the dataset's other sources.
func renameTable(tx *sql.Tx, req RenameTreeNodeRequest) (lang.ItemLabelOutcome, error) {
	sanitizedName, err := security.SanitizeIdentifier(req.NewName)
	if err != nil {
		return lang.ItemLabelOutcome{}, fmt.Errorf("invalid table name: %w", err)
	}

	var oldName string
	if err := tx.QueryRow("SELECT table_name FROM system_db_tables WHERE id = $1", req.ItemID).Scan(&oldName); err != nil {
		return lang.ItemLabelOutcome{}, fmt.Errorf("table not found (id=%d): %w", req.ItemID, err)
	}

	if err := dataset_routes.ValidateDatasetRouteAvailability(tx, sanitizedName, req.ItemID); err != nil {
		return lang.ItemLabelOutcome{}, err
	}

	if oldName != sanitizedName {
		renameSQL := fmt.Sprintf("ALTER TABLE %s RENAME TO %s",
			pq.QuoteIdentifier(oldName),
			pq.QuoteIdentifier(sanitizedName),
		)
		if _, err := tx.Exec(renameSQL); err != nil {
			return lang.ItemLabelOutcome{}, fmt.Errorf("ALTER TABLE RENAME %s → %s: %w", oldName, sanitizedName, err)
		}
		log.Printf("[HandleRenameTreeNode] ALTER TABLE %s RENAME TO %s", oldName, sanitizedName)
	}
	if err := automation_metadata.RenameDataset(tx, oldName, sanitizedName); err != nil {
		return lang.ItemLabelOutcome{}, err
	}

	if _, err := tx.Exec("UPDATE system_db_tables SET table_name = $1, updated = NOW() WHERE id = $2",
		sanitizedName, req.ItemID); err != nil {
		return lang.ItemLabelOutcome{}, fmt.Errorf("update table_name: %w", err)
	}

	// The label moves first, while its source still names the old table; the rewrite below
	// then renames the dataset's column, header and value sources, which stay on their own keys.
	label, err := lang.MoveRenamedItemLabel(tx, itemLabelRename(req, "table", oldName, sanitizedName))
	if err != nil {
		return lang.ItemLabelOutcome{}, fmt.Errorf("move dataset label: %w", err)
	}
	if oldName != sanitizedName {
		if cleanErr := lang.UpdateLangKeySourcesForTableRename(tx, oldName, sanitizedName); cleanErr != nil {
			return lang.ItemLabelOutcome{}, fmt.Errorf("update dataset label associations: %w", cleanErr)
		}
	}

	return label, nil
}
