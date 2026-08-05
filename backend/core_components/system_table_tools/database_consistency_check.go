// database_consistency_check.go
// Runs a suite of database consistency checks and returns a report.
// Bridges the check-query definitions and the admin consistency-report endpoint.
// Exists to detect orphaned records, broken foreign keys, and integrity issues across tables.
package system_table_tools

import (
	"easelect/backend/core_components/dbutils"
	dtt_system_table_folders "easelect/backend/core_components/dynamic_table_tools/dtt_table_folders"
	"easelect/backend/core_components/httpresponse"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
)

// ConsistencyIssue kuvaa yhtä löydettyä epäyhtenäisyyttä
type ConsistencyIssue struct {
	ID          string `json:"id"`          // Yksilöivä tunniste korjausta varten
	Category    int    `json:"category"`    // Kategoria 1-6
	Table       string `json:"table"`       // Mikä taulu / rivi koskee
	Description string `json:"description"` // Kuvaus ongelmasta
}

// ConsistencyCheckResult sisältää kaikkien tarkistusten tulokset
type ConsistencyCheckResult struct {
	Categories []CategoryResult `json:"categories"`
	TotalCount int              `json:"total_count"`
}

// CategoryResult yhden kategorian tulokset
type CategoryResult struct {
	Number       int                `json:"number"`
	Title        string             `json:"title"`
	TitleLangKey string             `json:"title_lang_key"`
	Issues       []ConsistencyIssue `json:"issues"`
}

// CheckDatabaseConsistencyHandler palauttaa kaikki löydetyt epäyhtenäisyydet JSON-muodossa.
func CheckDatabaseConsistencyHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "only GET allowed")
		return
	}

	result := ConsistencyCheckResult{}

	// 1. Orvot system_db_tables-rivit (taulu löytyy rekisteristä mutta ei PostgreSQL:stä)
	cat1 := checkOrphanSystemDbTableRows()
	result.Categories = append(result.Categories, cat1)

	// 2. Rekisteröimättömät taulut (PostgreSQL:ssä mutta ei system_db_tables:ssa)
	cat2 := checkUnregisteredTables()
	result.Categories = append(result.Categories, cat2)

	// 3. Orvot system_column_details-rivit (viittaavat puuttuvaan table_uid:hen)
	cat3 := checkOrphanColumnDetails()
	result.Categories = append(result.Categories, cat3)

	// 4. Epäyhtenäiset sarakkeet (system_column_details vs. pg_catalog)
	cat4 := checkInconsistentColumns()
	result.Categories = append(result.Categories, cat4)

	// 5. Orvot viiteavainrivit (1:M ja M:M, viittaavat puuttuviin tauluihin)
	cat5 := checkOrphanForeignKeyRelations()
	result.Categories = append(result.Categories, cat5)

	// 6. Orvot oikeusrivit (system_group_table_func_rights viittaa puuttuviin tauluihin)
	cat6 := checkOrphanPermissionRows()
	result.Categories = append(result.Categories, cat6)

	// 7. Roskaavaimet (HTML-fragmentit yms.)
	cat7 := checkGarbageLangKeys()
	result.Categories = append(result.Categories, cat7)

	// 8. Orpoavaimet (ei koodissa, ei skeemassa, ei koskaan käytetty)
	// MarkOrphanLangKeys() vaatii tuoreen skannauksen (SourceScanIsFresh guard).
	// Ajetaan skannaus vain jos edellisestä on kulunut yli 5 min (startup tai API hoitaa normaalisti).
	if !SourceScanIsFresh() {
		PopulateLangKeySources()
	}
	MarkOrphanLangKeys()
	cat8 := checkOrphanLangKeys()
	result.Categories = append(result.Categories, cat8)

	totalCount := 0
	for _, cat := range result.Categories {
		totalCount += len(cat.Issues)
	}
	result.TotalCount = totalCount

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

// FixDatabaseConsistencyHandler korjaa yksittäisen tai kaikki löydetyt ongelmat.
// Pyyntö: POST { "fix_ids": ["cat1_tablename", ...], "fix_action": {"cat2_table": "drop|register"} } tai { "fix_all": true }
func FixDatabaseConsistencyHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "only POST allowed")
		return
	}

	var req struct {
		FixIDs    []string          `json:"fix_ids"`
		FixAll    bool              `json:"fix_all"`
		FixAction map[string]string `json:"fix_action"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid data")
		return
	}

	// Jos fix_all, haetaan kaikki ongelmat ja korjataan ne
	var idsToFix []string
	if req.FixAll {
		allIssues := getAllIssues()
		for _, issue := range allIssues {
			if issue.Category == 2 {
				log.Printf("[FixDatabaseConsistency] skipping category 2 issue %s (requires explicit drop/register choice)", issue.ID)
				continue
			}
			idsToFix = append(idsToFix, issue.ID)
		}
	} else {
		idsToFix = req.FixIDs
	}

	if len(idsToFix) == 0 {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"fixed": 0, "errors": []string{}})
		return
	}

	tx, ok := dbutils.RequireTx(r.Context())
	if !ok {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "failed to acquire transaction")
		return
	}

	fixed := 0
	var fixErrors []string

	for _, id := range idsToFix {
		err := fixIssue(tx, id, req.FixAction)
		if err != nil {
			errMsg := fmt.Sprintf("%s: %v", id, err)
			fixErrors = append(fixErrors, errMsg)
			log.Printf("[FixDatabaseConsistency] error fixing %s: %v", id, err)
		} else {
			fixed++
			log.Printf("[FixDatabaseConsistency] fixed: %s", id)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"fixed":  fixed,
		"errors": fixErrors,
	})
}

// getAllIssues hakee kaikki ongelmat (käytetään fix_all:ssa)
func getAllIssues() []ConsistencyIssue {
	var all []ConsistencyIssue
	cats := []CategoryResult{
		checkOrphanSystemDbTableRows(),
		checkUnregisteredTables(),
		checkOrphanColumnDetails(),
		checkInconsistentColumns(),
		checkOrphanForeignKeyRelations(),
		checkOrphanPermissionRows(),
		checkGarbageLangKeys(),
		checkOrphanLangKeys(),
	}
	for _, cat := range cats {
		all = append(all, cat.Issues...)
	}
	return all
}

// fixIssue korjaa yksittäisen ongelman ID:n perusteella
func fixIssue(q dbutils.Querier, id string, fixActions map[string]string) error {
	// Parsitaan ID: "catN_tablename" tai "catN_uid_NNN"
	var category int
	var identifier string
	_, err := fmt.Sscanf(id, "cat%d_%s", &category, &identifier)
	if err != nil {
		return fmt.Errorf("invalid fix ID: %s", id)
	}

	switch category {
	case 1:
		// Orvot system_db_tables-rivit: poistetaan rivi (taulu ei enää ole PostgreSQL:ssä)
		_, execErr := q.Exec("DELETE FROM system_db_tables WHERE table_name = $1", identifier)
		return execErr
	case 2:
		// Rekisteröimättömät taulut: pudota taulu tai rekisteröi system-tauluihin
		action := strings.ToLower(strings.TrimSpace(fixActions[id]))
		if action == "" {
			action = "drop" // taaksepäinyhteensopivuus: aiempi oletus
		}

		var schemaName string
		schemaErr := q.QueryRow(`
			SELECT n.nspname FROM pg_class c
			JOIN pg_namespace n ON n.oid = c.relnamespace
			WHERE c.relname = $1 AND c.relkind = 'r'
			  AND n.nspname NOT LIKE 'pg_%'
			  AND n.nspname <> 'information_schema'
			LIMIT 1
		`, identifier).Scan(&schemaName)
		if schemaErr != nil {
			return fmt.Errorf("schema not found for table %s: %v", identifier, schemaErr)
		}

		switch action {
		case "drop":
			dropSQL := fmt.Sprintf(`DROP TABLE IF EXISTS "%s"."%s" CASCADE`, schemaName, identifier)
			log.Printf("[FixDatabaseConsistency] dropping table: %s", dropSQL)
			_, execErr := q.Exec(dropSQL)
			return execErr
		case "register":
			defaultFolderID, folderErr := dtt_system_table_folders.EnsureDatabaseOtherTablesFolder(q)
			if folderErr != nil {
				return fmt.Errorf("failed to resolve default folder for table %s: %v", identifier, folderErr)
			}

			var tableUID int64
			insertTableErr := q.QueryRow(`
				INSERT INTO system_db_tables (table_name, schema_name, is_default, is_removable, folder_id)
				VALUES ($1, $2, false, true, $3)
				RETURNING table_uid
			`, identifier, schemaName, defaultFolderID).Scan(&tableUID)
			if insertTableErr != nil {
				return fmt.Errorf("table registration failed (%s.%s): %v", schemaName, identifier, insertTableErr)
			}

			_, insertColsErr := q.Exec(`
				INSERT INTO system_column_details (table_uid, column_name, data_type, co_number)
				SELECT $1, c.column_name, c.data_type, c.ordinal_position
				FROM information_schema.columns c
				WHERE c.table_schema = $2
				  AND c.table_name = $3
				ORDER BY c.ordinal_position
			`, tableUID, schemaName, identifier)
			if insertColsErr != nil {
				return fmt.Errorf("column registration failed (%s.%s): %v", schemaName, identifier, insertColsErr)
			}

			log.Printf("[FixDatabaseConsistency] registered table %s.%s in system tables", schemaName, identifier)
			return nil
		default:
			return fmt.Errorf("unknown fix_action for category 2 (%s): %s", id, action)
		}
	case 3:
		// Orvot system_column_details: poistetaan table_uid:n perusteella
		_, execErr := q.Exec("DELETE FROM system_column_details WHERE table_uid = $1::bigint", identifier)
		return execErr
	case 4:
		// Epäyhtenäiset sarakkeet: poistetaan system_column_details-rivi
		parts := strings.SplitN(identifier, ".", 2)
		if len(parts) != 2 {
			return fmt.Errorf("invalid column ID: %s", identifier)
		}
		_, execErr := q.Exec(`
			DELETE FROM system_column_details
			WHERE table_uid = (SELECT table_uid FROM system_db_tables WHERE table_name = $1 LIMIT 1)
			  AND column_name = $2
		`, parts[0], parts[1])
		return execErr
	case 5:
		// Orvot viiteavainrivit: poistetaan id:n perusteella (muoto: cat5_1m_ID tai cat5_mm_ID)
		if strings.HasPrefix(identifier, "1m_") {
			rowID := strings.TrimPrefix(identifier, "1m_")
			_, execErr := q.Exec("DELETE FROM system_foreign_key_relations_1_m WHERE id = $1::bigint", rowID)
			return execErr
		} else if strings.HasPrefix(identifier, "mm_") {
			rowID := strings.TrimPrefix(identifier, "mm_")
			_, execErr := q.Exec("DELETE FROM system_foreign_key_relations_m_m WHERE id = $1::bigint", rowID)
			return execErr
		}
		return fmt.Errorf("invalid foreign key ID: %s", identifier)
	case 6:
		// Orvot oikeusrivit: poistetaan id:n perusteella
		_, execErr := q.Exec("DELETE FROM system_group_table_func_rights WHERE id = $1::bigint", identifier)
		return execErr
	case 7:
		// Roskaavaimet: poistetaan id:n perusteella
		_, execErr7 := q.Exec("DELETE FROM system_lang_keys WHERE id = $1::bigint", identifier)
		return execErr7
	case 8:
		// Orpoavaimet: poistetaan id:n perusteella
		_, execErr8 := q.Exec("DELETE FROM system_lang_keys WHERE id = $1::bigint", identifier)
		return execErr8
	default:
		return fmt.Errorf("fix for category %d is not supported", category)
	}
}
