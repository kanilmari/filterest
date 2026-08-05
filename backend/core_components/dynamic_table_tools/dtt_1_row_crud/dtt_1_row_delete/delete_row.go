// delete_row.go
// HTTP handler for deleting rows from dynamic tables.
// Bridges the frontend delete request, system-table special cases, and the deletion log.
// Exists to handle row deletion including DDL side-effects for system tables.

package dtt_1_row_delete

import (
	"context"
	"database/sql"
	"errors"

	"easelect/backend/core_components/dbutils"
	dtt_1_row_read "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read"
	"easelect/backend/core_components/dynamic_table_tools/dtt_3_table_crud/dtt_3_table_delete"
	dtt_asset_linking "easelect/backend/core_components/dynamic_table_tools/dtt_asset_linking"
	dtt_crud_workflows "easelect/backend/core_components/dynamic_table_tools/dtt_crud_workflows"
	"easelect/backend/core_components/event_bus"
	"easelect/backend/core_components/httpresponse"
	media_utils "easelect/backend/core_components/media_utils"
	"easelect/backend/core_components/security"
	e_sessions "easelect/backend/core_components/sessions"
	storagecleanup "easelect/backend/core_components/storagecleanup"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/lib/pq"
)

// badRequestError distinguishes 400 errors from generic 500 errors in extracted helpers.
type badRequestError struct{ msg string }

func (e *badRequestError) Error() string { return e.msg }

type forbiddenError struct{ msg string }

func (e *forbiddenError) Error() string { return e.msg }

const deleteRLSPilotTableName = "app_service_catalog"

type revokePrivilegeScope string

const (
	revokeColumnPrivilegeScope revokePrivilegeScope = "column"
	revokeTablePrivilegeScope  revokePrivilegeScope = "table"
)

func DeleteRowsHandlerWrapper(w http.ResponseWriter, r *http.Request) {
	tableName := r.URL.Query().Get("dataset")
	if tableName == "" {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "dataset parameter is missing")
		return
	}
	DeleteRowsHandler(w, r, tableName)
}

func DeleteRowsHandler(w http.ResponseWriter, r *http.Request, table_name string) {
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var request_data struct {
		IDs  []int               `json:"ids"`
		Rows []map[string]string `json:"rows"`
	}

	if err := json.NewDecoder(r.Body).Decode(&request_data); err != nil {
		log.Printf("error decoding data: %v", err)
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid data")
		return
	}

	tx, ok := dbutils.GetTx(r.Context())
	if !ok {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "transaction missing")
		return
	}

	if len(request_data.IDs) == 0 && len(request_data.Rows) == 0 {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "no rows to delete")
		return
	}

	// Special-case dispatches: system tables, privilege views, column details
	switch table_name {
	case "system_db_tables":
		if err := deleteSystemTables(r.Context(), tx, request_data.IDs); err != nil {
			log.Printf("error: %v", err)
			httpresponse.RespondWithError(w, http.StatusInternalServerError, err.Error())
			return
		}
		respondOK(w, "Valitut taulut poistettiin onnistuneesti")
		return

	case "systemview_role_column_privileges":
		if err := revokeColumnPrivileges(tx, request_data.IDs, request_data.Rows); err != nil {
			log.Printf("error: %v", err)
			httpresponse.RespondWithError(w, http.StatusInternalServerError, err.Error())
			return
		}
		respondOK(w, "Oikeudet poistettu onnistuneesti")
		return

	case "systemview_role_table_privileges":
		if err := revokeTablePrivileges(tx, request_data.IDs, request_data.Rows); err != nil {
			log.Printf("error: %v", err)
			httpresponse.RespondWithError(w, http.StatusInternalServerError, err.Error())
			return
		}
		respondOK(w, "Oikeudet poistettu onnistuneesti")
		return
	}

	// Generic deletes must authorize every target before column DDL, storage
	// planning, or other side effects. The DELETE repeats this predicate and
	// rolls back partial results, avoiding an UPDATE-strength preflight lock.
	if len(request_data.IDs) == 0 {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "no rows to delete")
		return
	}
	actor := dbutils.RequestActorContextFromRequest(r)
	rowsVisible, err := dtt_1_row_read.RowsVisibleForDelete(
		tx,
		table_name,
		actor.UserRole,
		actor.UserID,
		intIDsToInt64(request_data.IDs),
	)
	if err != nil {
		log.Printf("error checking delete row permissions for %s: %v", table_name, err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "Error checking row permissions")
		return
	}
	if !rowsVisible {
		httpresponse.RespondWithError(w, http.StatusForbidden, "one or more requested rows are not deletable by the current actor")
		return
	}

	// system_column_details pre-processing: remove actual columns before the generic row delete
	if table_name == "system_column_details" {
		if err := preprocessColumnDetailsDeletion(tx, request_data.IDs); err != nil {
			log.Printf("error: %v", err)
			var bre *badRequestError
			if errors.As(err, &bre) {
				httpresponse.RespondWithError(w, http.StatusBadRequest, bre.msg)
			} else {
				httpresponse.RespondWithError(w, http.StatusInternalServerError, err.Error())
			}
			return
		}
	}

	deletedBy := "system"
	if userID, err := e_sessions.GetUserIDFromSession(r); err == nil {
		deletedBy = fmt.Sprintf("%d", userID)
	}

	cacheSyncPlan, err := dtt_asset_linking.CollectSharedAssetParentCacheSyncPlan(
		tx,
		table_name,
		intIDsToInt64(request_data.IDs),
	)
	if err != nil {
		log.Printf("error collecting shared asset cache sync plan: %v", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "Error collecting shared asset cache sync plan")
		return
	}
	sharedAssetFileMoves, err := dtt_asset_linking.CollectSharedAssetFileMoves(
		tx,
		table_name,
		intIDsToInt64(request_data.IDs),
	)
	if err != nil {
		log.Printf("error collecting shared asset file moves: %v", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "Error collecting shared asset file moves")
		return
	}
	// Resolve filesystem work while the rows still exist, but do not move
	// anything until the database delete has succeeded (and, for normal HTTP
	// requests, committed).
	childStorageMoves := collectChildAssetStorageMoves(tx, table_name, request_data.IDs)
	rowStorageMoves := collectRowStorageMoves(tx, table_name, request_data.IDs)

	if err := deleteGenericRows(tx, table_name, request_data.IDs, deletedBy, actor.UserRole, actor.UserID); err != nil {
		log.Printf("error: %v", err)
		var fe *forbiddenError
		if errors.As(err, &fe) {
			httpresponse.RespondWithError(w, http.StatusForbidden, fe.msg)
			return
		}
		httpresponse.RespondWithError(w, http.StatusInternalServerError, err.Error())
		return
	}

	fileMoves := append([]dtt_asset_linking.SharedAssetFileMove(nil), sharedAssetFileMoves...)
	storageMoves := append([]rowStorageMove(nil), childStorageMoves...)
	storageMoves = append(storageMoves, rowStorageMoves...)
	applyStorageMoves := func() {
		moveSharedAssetFilesToDeleted(fileMoves)
		moveRowStoragePlansToDeleted(storageMoves)
	}
	if len(fileMoves) > 0 || len(storageMoves) > 0 {
		if !dbutils.RegisterAfterCommitHook(r.Context(), applyStorageMoves) {
			// Non-lazy test/tool contexts have no request commit hook; the database
			// mutation has nevertheless succeeded before this fallback runs.
			applyStorageMoves()
		}
	}

	if err := dtt_asset_linking.ResyncSharedAssetParentCache(tx, cacheSyncPlan); err != nil {
		log.Printf("error syncing shared asset cache: %v", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "Error syncing shared asset cache")
		return
	}

	publishDeleteEvents := func() {
		for _, rowID := range request_data.IDs {
			event_bus.Bus.Publish(table_name, event_bus.Event{
				Table:  table_name,
				RowID:  int64(rowID),
				Action: "delete",
			})
		}
	}
	if !dbutils.RegisterAfterCommitHook(r.Context(), publishDeleteEvents) {
		// Non-lazy test/tool contexts publish immediately as a fallback.
		publishDeleteEvents()
	}

	respondOK(w, "Rivit poistettu onnistuneesti")
}

func intIDsToInt64(ids []int) []int64 {
	if len(ids) == 0 {
		return nil
	}

	converted := make([]int64, 0, len(ids))
	for _, id := range ids {
		converted = append(converted, int64(id))
	}
	return converted
}

// ── extracted helpers ──────────────────────────────────────────────────

// deleteSystemTables drops PostgreSQL tables and cleans up metadata.
func deleteSystemTables(ctx context.Context, tx *sql.Tx, ids []int) error {
	for _, oneID := range ids {
		var foundTableName string
		var tableUID sql.NullInt64
		var schemaName sql.NullString

		err := tx.QueryRow(
			"SELECT table_name, table_uid, schema_name FROM system_db_tables WHERE id = $1", oneID,
		).Scan(&foundTableName, &tableUID, &schemaName)
		if err != nil {
			return fmt.Errorf("error fetching table name: %w", err)
		}

		dropQuery := fmt.Sprintf("DROP TABLE IF EXISTS %s CASCADE", pq.QuoteIdentifier(foundTableName))
		if _, err = tx.Exec(dropQuery); err != nil {
			return fmt.Errorf("error dropping table (%s): %w", foundTableName, err)
		}
		log.Printf("[DeleteRows/system_db_tables] PostgreSQL table %s dropped (DROP TABLE CASCADE)", foundTableName)

		if tableUID.Valid {
			storagecleanup.QueueArchiveTableStorageAfterCommit(ctx, fmt.Sprintf("%d", tableUID.Int64))
			if err = dtt_3_table_delete.CleanupTableMetadata(tx, tableUID.Int64, schemaName.String); err != nil {
				return fmt.Errorf("error cleaning up metadata for table %s: %w", foundTableName, err)
			}
		} else {
			if _, err = tx.Exec("DELETE FROM system_db_tables WHERE id = $1", oneID); err != nil {
				return fmt.Errorf("error deleting row from system_db_tables: %w", err)
			}
		}
	}
	return nil
}

// canonicalizeRevokePrivilege converts one privilege emitted by PostgreSQL's
// information_schema column/table privilege views to its SQL keyword. The
// closed allowlist prevents request or view data from introducing extra tokens
// or statements into a REVOKE command.
func canonicalizeRevokePrivilege(rawPrivilege string, scope revokePrivilegeScope) (string, error) {
	privilegeTokens := strings.Fields(rawPrivilege)
	if len(privilegeTokens) != 1 {
		return "", fmt.Errorf("invalid %s privilege %q", scope, rawPrivilege)
	}

	canonicalPrivilege := strings.ToUpper(privilegeTokens[0])
	switch scope {
	case revokeColumnPrivilegeScope:
		switch canonicalPrivilege {
		case "SELECT", "INSERT", "UPDATE", "REFERENCES":
			return canonicalPrivilege, nil
		}
	case revokeTablePrivilegeScope:
		switch canonicalPrivilege {
		case "SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER":
			return canonicalPrivilege, nil
		}
	default:
		return "", fmt.Errorf("invalid privilege scope %q", scope)
	}

	return "", fmt.Errorf("unsupported %s privilege %q", scope, rawPrivilege)
}

// revokeColumnPrivileges revokes column-level privileges by ID or by row data.
func revokeColumnPrivileges(tx *sql.Tx, ids []int, rows []map[string]string) error {
	if len(ids) > 0 {
		for _, oneID := range ids {
			var roleName, tableSchema, tableName, columnName, privilege string
			err := tx.QueryRow(
				"SELECT role_name, table_schema, table_name, column_name, privilege FROM systemview_role_column_privileges WHERE id = $1",
				oneID,
			).Scan(&roleName, &tableSchema, &tableName, &columnName, &privilege)
			if err != nil {
				return fmt.Errorf("error fetching row: %w", err)
			}
			canonicalPrivilege, err := canonicalizeRevokePrivilege(privilege, revokeColumnPrivilegeScope)
			if err != nil {
				return err
			}

			revokeStmt := fmt.Sprintf(
				"REVOKE %s (%s) ON %s.%s FROM %s",
				canonicalPrivilege,
				pq.QuoteIdentifier(columnName),
				pq.QuoteIdentifier(tableSchema),
				pq.QuoteIdentifier(tableName),
				pq.QuoteIdentifier(roleName),
			)
			if _, err := tx.Exec(revokeStmt); err != nil {
				return fmt.Errorf("error revoking privilege: %w", err)
			}
		}
	} else {
		for _, row := range rows {
			canonicalPrivilege, err := canonicalizeRevokePrivilege(row["privilege"], revokeColumnPrivilegeScope)
			if err != nil {
				return err
			}
			revokeStmt := fmt.Sprintf(
				"REVOKE %s (%s) ON %s.%s FROM %s",
				canonicalPrivilege,
				pq.QuoteIdentifier(row["column_name"]),
				pq.QuoteIdentifier(row["table_schema"]),
				pq.QuoteIdentifier(row["table_name"]),
				pq.QuoteIdentifier(row["role_name"]),
			)
			if _, err := tx.Exec(revokeStmt); err != nil {
				return fmt.Errorf("error revoking privilege: %w", err)
			}
		}
	}
	return nil
}

// revokeTablePrivileges revokes table-level privileges by ID or by row data.
func revokeTablePrivileges(tx *sql.Tx, ids []int, rows []map[string]string) error {
	if len(ids) > 0 {
		for _, oneID := range ids {
			var roleName, tableSchema, tableName, privilege string
			err := tx.QueryRow(
				"SELECT role_name, table_schema, table_name, privilege FROM systemview_role_table_privileges WHERE id = $1",
				oneID,
			).Scan(&roleName, &tableSchema, &tableName, &privilege)
			if err != nil {
				return fmt.Errorf("error fetching row: %w", err)
			}
			canonicalPrivilege, err := canonicalizeRevokePrivilege(privilege, revokeTablePrivilegeScope)
			if err != nil {
				return err
			}

			revokeStmt := fmt.Sprintf(
				"REVOKE %s ON %s.%s FROM %s",
				canonicalPrivilege,
				pq.QuoteIdentifier(tableSchema),
				pq.QuoteIdentifier(tableName),
				pq.QuoteIdentifier(roleName),
			)
			if _, err := tx.Exec(revokeStmt); err != nil {
				return fmt.Errorf("error revoking privilege: %w", err)
			}
		}
	} else {
		for _, row := range rows {
			canonicalPrivilege, err := canonicalizeRevokePrivilege(row["privilege"], revokeTablePrivilegeScope)
			if err != nil {
				return err
			}
			revokeStmt := fmt.Sprintf(
				"REVOKE %s ON %s.%s FROM %s",
				canonicalPrivilege,
				pq.QuoteIdentifier(row["table_schema"]),
				pq.QuoteIdentifier(row["table_name"]),
				pq.QuoteIdentifier(row["role_name"]),
			)
			if _, err := tx.Exec(revokeStmt); err != nil {
				return fmt.Errorf("error revoking privilege: %w", err)
			}
		}
	}
	return nil
}

// preprocessColumnDetailsDeletion removes actual PostgreSQL columns and updates
// metadata before the generic row delete handles the system_column_details rows.
func preprocessColumnDetailsDeletion(tx *sql.Tx, ids []int) error {
	for _, oneID := range ids {
		var colName string
		var tableUID int
		err := tx.QueryRow(
			"SELECT column_name, table_uid FROM system_column_details WHERE id = $1",
			oneID,
		).Scan(&colName, &tableUID)
		if err != nil {
			return fmt.Errorf("error fetching row: %w", err)
		}

		var tableName string
		err = tx.QueryRow(
			"SELECT table_name FROM system_db_tables WHERE table_uid = $1",
			tableUID,
		).Scan(&tableName)
		if err != nil {
			return fmt.Errorf("error fetching table name: %w", err)
		}

		sTable, serr := security.SanitizeIdentifier(tableName)
		if serr != nil {
			return &badRequestError{msg: "invalid table name"}
		}
		sCol, serr := security.SanitizeIdentifier(colName)
		if serr != nil {
			return &badRequestError{msg: "invalid column name"}
		}

		if err := dtt_crud_workflows.RemoveColumnsWithBridge(tx, sTable, []string{sCol}); err != nil {
			return fmt.Errorf("error removing column: %w", err)
		}
	}

	if err := dtt_crud_workflows.UpdateOidsAndTableNamesWithBridge(tx); err != nil {
		return fmt.Errorf("error updating metadata: %w", err)
	}
	return nil
}

// deleteGenericRows deletes rows by ID from the given table and logs the deletions.
func deleteGenericRows(tx *sql.Tx, tableName string, ids []int, deletedBy, userRole string, userID int) error {
	idPlaceholders := make([]string, len(ids))
	args := make([]interface{}, len(ids))
	for i, oneID := range ids {
		idPlaceholders[i] = fmt.Sprintf("$%d", i+1)
		args[i] = oneID
	}

	quotedTable := pq.QuoteIdentifier(tableName)
	whereClause := fmt.Sprintf(
		" WHERE %s.%s IN (%s)",
		quotedTable,
		pq.QuoteIdentifier("id"),
		strings.Join(idPlaceholders, ", "),
	)
	var err error
	whereClause, args, err = dtt_1_row_read.AppendMutationRowPolicyToWhereClause(
		tx,
		tableName,
		userRole,
		userID,
		whereClause,
		args,
	)
	if err != nil {
		return fmt.Errorf("error building delete row policy for table %s: %w", tableName, err)
	}
	query := fmt.Sprintf("DELETE FROM %s%s", quotedTable, whereClause)

	if _, err := tx.Exec(`SAVEPOINT generic_row_delete`); err != nil {
		return fmt.Errorf("error creating delete savepoint for table %s: %w", tableName, err)
	}

	result, err := tx.Exec(query, args...)
	if err != nil {
		return rollbackGenericRowDelete(
			tx,
			fmt.Errorf("error deleting rows from table %s: %w", tableName, err),
		)
	}

	deletedRows, rowsErr := result.RowsAffected()
	if rowsErr != nil {
		return rollbackGenericRowDelete(
			tx,
			fmt.Errorf("error verifying deleted rows for table %s: %w", tableName, rowsErr),
		)
	}
	if deletedRows != int64(countUniqueIDs(ids)) {
		return rollbackGenericRowDelete(
			tx,
			&forbiddenError{msg: "one or more requested rows were not deletable by the current actor"},
		)
	}

	if _, err := tx.Exec(`RELEASE SAVEPOINT generic_row_delete`); err != nil {
		return fmt.Errorf("error releasing delete savepoint for table %s: %w", tableName, err)
	}

	logDeletionsToLog(tx, tableName, ids, deletedBy)
	return nil
}

// rollbackGenericRowDelete removes any rows changed since the generic delete
// savepoint. This keeps a request transaction safe to commit even when the
// DELETE itself only affected a subset of the requested IDs.
func rollbackGenericRowDelete(tx *sql.Tx, cause error) error {
	if _, err := tx.Exec(`ROLLBACK TO SAVEPOINT generic_row_delete`); err != nil {
		return fmt.Errorf("%w; failed to roll back generic row delete: %v", cause, err)
	}
	if _, err := tx.Exec(`RELEASE SAVEPOINT generic_row_delete`); err != nil {
		return fmt.Errorf("%w; failed to release generic row delete savepoint: %v", cause, err)
	}
	return cause
}

func countUniqueIDs(ids []int) int {
	seen := make(map[int]struct{}, len(ids))
	for _, id := range ids {
		seen[id] = struct{}{}
	}
	return len(seen)
}

// respondOK writes a 200 JSON response with a message field.
func respondOK(w http.ResponseWriter, message string) {
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"message": message})
}

// ── file storage helper ────────────────────────────────────────────────

type rowQueryer interface {
	QueryRow(query string, args ...interface{}) *sql.Row
}

type rowStorageMove struct {
	tableUID string
	rowID    int
}

// collectChildAssetStorageMoves resolves legacy child media storage before a
// parent DELETE CASCADE removes the child rows. It is database-only: the caller
// decides when the resulting filesystem moves are safe to execute.
func collectChildAssetStorageMoves(tx *sql.Tx, parentTableName string, parentIDs []int) []rowStorageMove {
	if len(parentIDs) == 0 {
		return nil
	}

	// Prefer explicit FK metadata to find legacy file_upload children that still
	// own their own row-based storage. Shared `<parent>_assets` relations are
	// cleaned via CollectSharedAssetFileMoves, so table-name guessing is no
	// longer used here.
	rows, err := tx.Query(`
		SELECT s.table_name, fk.source_column_name
		FROM system_foreign_key_relations_1_m fk
		JOIN system_db_tables s ON s.table_uid = fk.source_table_uid
		JOIN system_db_tables t ON t.table_uid = fk.target_table_uid
		WHERE t.table_name = $1
		  AND fk.target_insert_specs->'file_upload' IS NOT NULL
		  AND COALESCE(jsonb_typeof(fk.target_insert_specs->'file_upload'->'profiles'), '') <> 'object'
		  AND COALESCE(fk.target_insert_specs->'file_upload'->>'profile_key', '') <> 'asset_linking'
	`, parentTableName)
	if err != nil {
		log.Printf("[collectChildAssetStorageMoves] error querying child asset tables for %s: %v", parentTableName, err)
		return nil
	}
	defer rows.Close()

	type childInfo struct {
		tableName string
		fkColumn  string
	}
	var children []childInfo
	for rows.Next() {
		var ci childInfo
		if err := rows.Scan(&ci.tableName, &ci.fkColumn); err != nil {
			log.Printf("[collectChildAssetStorageMoves] error scanning row: %v", err)
			continue
		}
		children = append(children, ci)
	}
	if err := rows.Err(); err != nil {
		log.Printf("[collectChildAssetStorageMoves] row iteration error: %v", err)
	}

	var storageMoves []rowStorageMove
	// For each child asset table, resolve affected row IDs while they still exist.
	for _, child := range children {
		placeholders := make([]string, len(parentIDs))
		args := make([]interface{}, len(parentIDs))
		for i, pid := range parentIDs {
			placeholders[i] = fmt.Sprintf("$%d", i+1)
			args[i] = pid
		}

		childQuery := fmt.Sprintf(
			"SELECT id FROM %s WHERE %s IN (%s)",
			pq.QuoteIdentifier(child.tableName),
			pq.QuoteIdentifier(child.fkColumn),
			strings.Join(placeholders, ", "),
		)

		childRows, err := tx.Query(childQuery, args...)
		if err != nil {
			log.Printf("[collectChildAssetStorageMoves] error querying child IDs from %s: %v", child.tableName, err)
			continue
		}

		var childIDs []int
		for childRows.Next() {
			var cid int
			if err := childRows.Scan(&cid); err != nil {
				log.Printf("[collectChildAssetStorageMoves] error scanning child ID: %v", err)
				continue
			}
			childIDs = append(childIDs, cid)
		}
		childRows.Close()

		if len(childIDs) > 0 {
			storageMoves = append(storageMoves, collectRowStorageMoves(tx, child.tableName, childIDs)...)
		}
	}
	return storageMoves
}

func collectRowStorageMoves(q rowQueryer, tableName string, ids []int) []rowStorageMove {
	if len(ids) == 0 {
		return nil
	}
	var tableUID string
	err := q.QueryRow(`SELECT table_uid FROM system_db_tables WHERE table_name = $1`, tableName).Scan(&tableUID)
	if err != nil {
		log.Printf("error fetching table_uid for table %s: %v", tableName, err)
		return nil
	}
	moves := make([]rowStorageMove, 0, len(ids))
	for _, id := range ids {
		moves = append(moves, rowStorageMove{tableUID: tableUID, rowID: id})
	}
	return moves
}

func moveRowStoragePlansToDeleted(moves []rowStorageMove) {
	for _, move := range moves {
		src := filepath.Join("storage", move.tableUID, fmt.Sprintf("%d", move.rowID))
		dst := filepath.Join("storage_deleted", move.tableUID, fmt.Sprintf("%d", move.rowID))

		if _, err := os.Stat(src); err == nil {
			if err := os.MkdirAll(filepath.Dir(dst), 0755); err != nil {
				log.Printf("error creating directory: %v", err)
				continue
			}
			if err := storagecleanup.MovePathToDeletedStorage(src, dst); err != nil {
				log.Printf("error moving directory %s -> %s: %v", src, dst, err)
			}
		}
	}
}

func moveSharedAssetFilesToDeleted(moves []dtt_asset_linking.SharedAssetFileMove) {
	if len(moves) == 0 {
		return
	}

	subfolders := append([]string(nil), media_utils.RequiredSubfolders...)
	if len(subfolders) == 0 {
		subfolders = []string{"original"}
	}

	for _, move := range moves {
		if move.StorageTableUID == "" || move.StorageRowID <= 0 || strings.TrimSpace(move.Filename) == "" {
			continue
		}

		for _, subfolder := range subfolders {
			src := filepath.Join(
				"storage",
				move.StorageTableUID,
				fmt.Sprintf("%d", move.StorageRowID),
				subfolder,
				move.Filename,
			)
			dst := filepath.Join(
				"storage_deleted",
				move.StorageTableUID,
				fmt.Sprintf("%d", move.StorageRowID),
				subfolder,
				move.Filename,
			)

			if _, err := os.Stat(src); err == nil {
				if err := os.MkdirAll(filepath.Dir(dst), 0755); err != nil {
					log.Printf("error creating shared asset deleted directory: %v", err)
					continue
				}
				if err := storagecleanup.MovePathToDeletedStorage(src, dst); err != nil {
					log.Printf("error moving shared asset file %s -> %s: %v", src, dst, err)
				}
			}
		}
	}
}
