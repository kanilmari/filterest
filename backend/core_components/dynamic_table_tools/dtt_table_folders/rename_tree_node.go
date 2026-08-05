// rename_tree_node.go
// HTTP handler for renaming a node (table or folder) in the table tree. Updates the display
// name in the tree structure stored in the database.
// Exists to coordinate technical names, translations, aliases, and folder metadata.
package dtt_system_table_folders

import (
	"database/sql"
	"easelect/backend/core_components/dataset_routes"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/httpresponse"
	"easelect/backend/core_components/lang"
	"easelect/backend/core_components/security"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"

	"github.com/lib/pq"
)

// RenameTreeNodeRequest on POST /api/rename-tree-node -pyynnön body
type RenameTreeNodeRequest struct {
	ItemID       int               `json:"item_id"`
	ItemType     string            `json:"item_type"`    // "folder" tai "table"
	NewName      string            `json:"new_name"`     // Uusi tekninen nimi (= uusi lang_key)
	Translations map[string]string `json:"translations"` // Käännökset: {"fi": "...", "en": "...", "ch": "..."}
}

// HandleRenameTreeNode käsittelee POST /api/rename-tree-node
func HandleRenameTreeNode(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

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

	tx, ok := dbutils.RequireTx(r.Context())
	if !ok {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "failed to acquire transaction")
		return
	}

	switch strings.ToLower(req.ItemType) {
	case "folder":
		if err := renameFolder(tx, req); err != nil {
			log.Printf("\033[31m[HandleRenameTreeNode] folder error: %v\033[0m\n", err)
			httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("error renaming folder: %v", err))
			return
		}
	case "table":
		if err := renameTable(tx, req); err != nil {
			log.Printf("\033[31m[HandleRenameTreeNode] table error: %v\033[0m\n", err)
			var conflictErr *dataset_routes.RouteConflictError
			if errors.As(err, &conflictErr) {
				httpresponse.RespondWithError(w, http.StatusConflict, conflictErr.Error())
				return
			}
			httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("error renaming table: %v", err))
			return
		}
	default:
		httpresponse.RespondWithError(w, http.StatusBadRequest, "item_type must be 'folder' or 'table'")
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"message": "Renamed successfully.",
	})
}

// renameFolder päivittää kansion nimen: system_table_folders + system_lang_keys
func renameFolder(tx *sql.Tx, req RenameTreeNodeRequest) error {
	// 1. Haetaan vanha nimi (= vanha lang_key)
	var oldName string
	if err := tx.QueryRow("SELECT folder_name FROM system_table_folders WHERE id = $1", req.ItemID).Scan(&oldName); err != nil {
		return fmt.Errorf("folder not found (id=%d): %w", req.ItemID, err)
	}

	// 2. Päivitetään system_table_folders.folder_name
	if _, err := tx.Exec("UPDATE system_table_folders SET folder_name = $1, updated = NOW() WHERE id = $2",
		req.NewName, req.ItemID); err != nil {
		return fmt.Errorf("update folder_name: %w", err)
	}

	// 3. Päivitetään system_lang_keys: vanha lang_key → uusi lang_key + käännökset
	if err := upsertLangKey(tx, oldName, req.NewName, "folder", req.Translations); err != nil {
		return fmt.Errorf("upsert lang_key: %w", err)
	}

	// 4. Päivitetään kansion lang key sources ja descriptions
	if oldName != req.NewName {
		if cleanErr := lang.UpdateLangKeySourcesForFolderRename(tx, oldName, req.NewName); cleanErr != nil {
			log.Printf("[HandleRenameTreeNode] warning: lang key source update for folder rename %s→%s: %v",
				oldName, req.NewName, cleanErr)
		}
	}

	return nil
}

// renameTable päivittää taulun nimen: ALTER TABLE RENAME + system_db_tables + system_lang_keys
func renameTable(tx *sql.Tx, req RenameTreeNodeRequest) error {
	// Sanitoidaan uusi nimi SQL-injektioiden ehkäisemiseksi
	sanitizedName, err := security.SanitizeIdentifier(req.NewName)
	if err != nil {
		return fmt.Errorf("invalid table name: %w", err)
	}

	// 1. Haetaan vanha nimi
	var oldName string
	if err := tx.QueryRow("SELECT table_name FROM system_db_tables WHERE id = $1", req.ItemID).Scan(&oldName); err != nil {
		return fmt.Errorf("table not found (id=%d): %w", req.ItemID, err)
	}

	if err := dataset_routes.ValidateDatasetRouteAvailability(tx, sanitizedName, req.ItemID); err != nil {
		return err
	}

	// 2. ALTER TABLE RENAME (varsinainen PostgreSQL-taulu)
	if oldName != sanitizedName {
		renameSQL := fmt.Sprintf("ALTER TABLE %s RENAME TO %s",
			pq.QuoteIdentifier(oldName),
			pq.QuoteIdentifier(sanitizedName),
		)
		if _, err := tx.Exec(renameSQL); err != nil {
			return fmt.Errorf("ALTER TABLE RENAME %s → %s: %w", oldName, sanitizedName, err)
		}
		log.Printf("[HandleRenameTreeNode] ALTER TABLE %s RENAME TO %s", oldName, sanitizedName)
	}

	// 3. Päivitetään system_db_tables.table_name
	if _, err := tx.Exec("UPDATE system_db_tables SET table_name = $1, updated = NOW() WHERE id = $2",
		sanitizedName, req.ItemID); err != nil {
		return fmt.Errorf("update table_name: %w", err)
	}

	// 4. Päivitetään system_lang_keys: vanha lang_key → uusi lang_key + käännökset
	if err := upsertLangKey(tx, oldName, sanitizedName, "table", req.Translations); err != nil {
		return fmt.Errorf("upsert lang_key: %w", err)
	}

	// 5. Päivitetään kaikki lang key sources ja descriptions jotka viittaavat vanhaan
	//    taulun nimeen (sekä table- että column-tyyppiset lähderivit ja kuvaukset).
	if oldName != sanitizedName {
		if cleanErr := lang.UpdateLangKeySourcesForTableRename(tx, oldName, sanitizedName); cleanErr != nil {
			log.Printf("[HandleRenameTreeNode] warning: lang key source update for table rename %s→%s: %v",
				oldName, sanitizedName, cleanErr)
			// Non-fatal: table is already renamed, metadata update is best-effort.
		}
	}

	return nil
}

// upsertLangKey päivittää tai luo system_lang_keys -rivin.
// Jos vanha lang_key löytyy → päivitetään lang_key + käännökset.
// Jos ei löydy → luodaan uusi rivi.
// Päivittää myös system_lang_key_sources-taulun lähdetiedot.
func upsertLangKey(tx *sql.Tx, oldKey, newKey string, itemType string, translations map[string]string) error {

	// Tarkistetaan, löytyykö vanha lang_key
	var existingID int64
	err := tx.QueryRow("SELECT id FROM system_lang_keys WHERE lang_key = $1", oldKey).Scan(&existingID)

	fi := translations["fi"]
	en := translations["en"]
	ch := translations["ch"]

	if err == nil {
		// Vanha löytyi → päivitetään
		_, execErr := tx.Exec(`
			UPDATE system_lang_keys 
			SET lang_key = $1, fi = $2, en = $3, ch = $4, updated = NOW()
			WHERE id = $5`,
			newKey, fi, en, ch, existingID)
		if execErr != nil {
			return fmt.Errorf("update lang_key: %w", execErr)
		}

		// Päivitetään source_high vanhan nimen tilalle uusi nimi
		// Note: For tables, this is also done by UpdateLangKeySourcesForTableRename()
		// which additionally handles column-type sources. The overlap is harmless
		// (idempotent UPDATE). This line must stay for folder renames which don't
		// go through UpdateLangKeySourcesForTableRename().
		if oldKey != newKey {
			_, _ = tx.Exec(`
				UPDATE system_lang_key_sources
				SET source_high = $1, source_low = $1, last_seen = CURRENT_DATE
				WHERE lang_key_id = $2 AND source_type = $3`,
				newKey, existingID, itemType)
		}

		// Varmistetaan että lähderivi on olemassa
		upsertLangKeySource(tx, existingID, itemType, newKey)
	} else {
		// Ei löytynyt → luodaan uusi
		var newID int64
		insertErr := tx.QueryRow(`
			INSERT INTO system_lang_keys (lang_key, fi, en, ch, created, updated)
			VALUES ($1, $2, $3, $4, NOW(), NOW())
			RETURNING id`,
			newKey, fi, en, ch).Scan(&newID)
		if insertErr != nil {
			return fmt.Errorf("insert lang_key: %w", insertErr)
		}

		// Luodaan lähderivi uudelle avaimelle
		upsertLangKeySource(tx, newID, itemType, newKey)
	}

	return nil
}

// upsertLangKeySource tekee UPSERT:n system_lang_key_sources-tauluun
// transaktiopohjaisesti. Varmistaa että lang_key:llä on lähdemerkintä.
func upsertLangKeySource(tx *sql.Tx, langKeyID int64, sourceType, sourceHigh string) {
	if langKeyID == 0 {
		return
	}
	_, err := tx.Exec(`
		INSERT INTO system_lang_key_sources (lang_key_id, source_type, source_high, source_low, last_seen)
		VALUES ($1, $2, $3, $3, CURRENT_DATE)
		ON CONFLICT (lang_key_id, source_type, source_high) DO UPDATE
		  SET source_low = EXCLUDED.source_low,
		      last_seen = CURRENT_DATE`,
		langKeyID, sourceType, sourceHigh)
	if err != nil {
		log.Printf("[upsertLangKeySource] error id=%d type=%s high=%s: %v", langKeyID, sourceType, sourceHigh, err)
	}
}
