// drop_table_handler.go
// HTTP handler for dropping PostgreSQL tables and cleaning up their system
// metadata. Prevents deletion of default or non-removable tables and cascades
// metadata cleanup via CleanupTableMetadata.

package dtt_3_table_delete

import (
	"database/sql"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read"
	"easelect/backend/core_components/httpresponse"
	"easelect/backend/core_components/security"
	storagecleanup "easelect/backend/core_components/storagecleanup"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
)

type DropTableRequest struct {
	TableName string `json:"dataset_name"`
}

func DropTableHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "only POST allowed")
		return
	}

	var req DropTableRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, fmt.Errorf("invalid data: %w", err).Error())
		return
	}

	if req.TableName == "" {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "table name is missing")
		return
	}

	sanitizedTableName, err := security.SanitizeIdentifier(req.TableName)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, fmt.Errorf("error validating table name: %w", err).Error())
		return
	}

	tx, ok := dbutils.RequireTx(r.Context())
	if !ok {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "failed to acquire transaction")
		return
	}

	// --- SAFETY CHECK START ---
	var isDefault bool
	var isRemovable bool
	// We use COALESCE(is_removable, true) to treat NULL as true (removable) just in case.
	checkQuery := `SELECT is_default, COALESCE(is_removable, true) FROM system_db_tables WHERE table_name = $1`
	err = tx.QueryRow(checkQuery, sanitizedTableName).Scan(&isDefault, &isRemovable)

	if err != nil {
		if err != sql.ErrNoRows {
			httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Errorf("error checking table details: %w", err).Error())
			return
		}
		// If table is not in system_db_tables, we proceed (it might be a raw table).
	} else {
		if isDefault {
			httpresponse.RespondWithError(w, http.StatusForbidden, "default table cannot be deleted")
			return
		}
		if !isRemovable {
			httpresponse.RespondWithError(w, http.StatusForbidden, "table cannot be deleted (is_removable=false)")
			return
		}
	}
	// --- SAFETY CHECK END ---

	// Haetaan table_uid ja schema_name ennen poistoa, jotta voimme siivota liittyvät tiedot
	var tableUID sql.NullInt64
	var schemaName sql.NullString
	uidQuery := `SELECT table_uid, schema_name FROM system_db_tables WHERE table_name = $1`
	if scanErr := tx.QueryRow(uidQuery, sanitizedTableName).Scan(&tableUID, &schemaName); scanErr != nil {
		log.Printf("[DropTableHandler] warning: could not look up table_uid/schema for %s: %v — metadata cleanup may be incomplete", sanitizedTableName, scanErr)
	}

	// Poistetaan taulu PostgreSQL:stä
	dropStmt := fmt.Sprintf("DROP TABLE %s CASCADE", sanitizedTableName)
	_, err = tx.Exec(dropStmt)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Errorf("error dropping table: %w", err).Error())
		return
	}
	log.Printf("[DropTableHandler] PostgreSQL table %s dropped (DROP TABLE CASCADE)", sanitizedTableName)

	// Invalidate metadata caches for the dropped table.
	dtt_1_row_read.InvalidateSchemaCache(sanitizedTableName)
	dtt_1_row_read.InvalidateDatasetExistsCache(sanitizedTableName)

	// Poistetaan liittyvät metatiedot system-tauluista (käytetään jaettua CleanupTableMetadata-funktiota)
	if tableUID.Valid {
		storagecleanup.QueueArchiveTableStorageAfterCommit(r.Context(), fmt.Sprintf("%d", tableUID.Int64))
		if cleanupErr := CleanupTableMetadata(tx, tableUID.Int64, schemaName.String); cleanupErr != nil {
			log.Printf("\033[31merror: [DropTableHandler] metadata cleanup failed for table %s: %v\033[0m", sanitizedTableName, cleanupErr)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": fmt.Sprintf("Taulu %s poistettu", sanitizedTableName)})
}

func DeleteRemovedTables(q dbutils.Querier) error {
	deleteQuery := `
WITH removed_tables AS (
        SELECT
                sdt.id,
                sdt.table_uid,
                sdt.schema_name
        FROM system_db_tables sdt
        WHERE NOT EXISTS (
                SELECT 1
                FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE
                        n.nspname = sdt.schema_name
                        AND c.relname = sdt.table_name
                        AND c.relkind = 'r'
                        AND n.nspname NOT LIKE 'pg_%'
                        AND n.nspname <> 'information_schema'
                        AND has_schema_privilege(n.nspname, 'USAGE')
                        AND has_table_privilege(c.oid, 'SELECT')
                        AND n.nspname NOT IN ('restricted', 'postgis')
        )
), removed_rights AS (
        DELETE FROM system_group_table_func_rights gf
        USING removed_tables rt
        WHERE
                rt.table_uid IS NOT NULL
                AND gf.target_table_uid = rt.table_uid
                AND gf.target_schema_name = rt.schema_name
        RETURNING gf.id
), removed_fk_1m AS (
        DELETE FROM system_foreign_key_relations_1_m fk
        USING removed_tables rt
        WHERE
                rt.table_uid IS NOT NULL
                AND (fk.source_table_uid = rt.table_uid OR fk.target_table_uid = rt.table_uid)
        RETURNING fk.id
), removed_fk_mm AS (
        DELETE FROM system_foreign_key_relations_m_m fk
        USING removed_tables rt
        WHERE
                rt.table_uid IS NOT NULL
                AND (fk.table_a_uid = rt.table_uid OR fk.table_b_uid = rt.table_uid)
        RETURNING fk.id
)
DELETE FROM system_db_tables sdt
USING removed_tables rt
WHERE sdt.id = rt.id;
    `
	_, err := q.Exec(deleteQuery)
	if err != nil {
		return fmt.Errorf("error deleting removed tables: %v", err)
	}
	return nil
}
