// deletion_log_writer.go
// Writes to the deletion_log table whenever rows are deleted via the generic handler.
// Bridges the delete handler and the deletion_log table.
// Exists to prevent the Environment Sync Tool from restoring intentionally deleted records.
package dtt_1_row_delete

import (
	"database/sql"
	"fmt"
	"log"
	"strings"
)

// logDeletionsToLog writes deletion entries to the deletion_log table.
// It uses INSERT ... ON CONFLICT DO NOTHING so re-deleting the same record is safe.
// deletedBy should be the user ID (as string) or "system" if no session is available.
func logDeletionsToLog(tx *sql.Tx, tableName string, ids []int, deletedBy string) {
	if len(ids) == 0 {
		return
	}

	// Skip logging for system/meta tables — these are structural, not user data
	skipTables := map[string]bool{
		"system_db_tables":                  true,
		"system_column_details":             true,
		"systemview_role_column_privileges": true,
		"systemview_role_table_privileges":  true,
		"deletion_log":                      true,
	}
	if skipTables[tableName] {
		return
	}

	// Build batch INSERT
	valueParts := make([]string, 0, len(ids))
	args := make([]interface{}, 0, len(ids)*3)
	for i, id := range ids {
		base := i * 3
		valueParts = append(valueParts, fmt.Sprintf("($%d, $%d, $%d)", base+1, base+2, base+3))
		args = append(args, tableName, fmt.Sprintf("%d", id), deletedBy)
	}

	query := fmt.Sprintf(
		"INSERT INTO deletion_log (table_name, record_id, deleted_by) VALUES %s ON CONFLICT (table_name, record_id) DO NOTHING",
		strings.Join(valueParts, ", "),
	)

	if _, err := tx.Exec(`SAVEPOINT deletion_log_insert`); err != nil {
		log.Printf("[deletion_log] Virhe savepointin luonnissa (%s, ids=%v): %v", tableName, ids, err)
		return
	}

	_, err := tx.Exec(query, args...)
	if err != nil {
		if _, rollbackErr := tx.Exec(`ROLLBACK TO SAVEPOINT deletion_log_insert`); rollbackErr != nil {
			log.Printf("[deletion_log] Virhe savepoint rollbackissa (%s, ids=%v): %v", tableName, ids, rollbackErr)
			return
		}
		log.Printf("[deletion_log] Virhe kirjauksen tallentamisessa (%s, ids=%v): %v", tableName, ids, err)
	}
	if _, err := tx.Exec(`RELEASE SAVEPOINT deletion_log_insert`); err != nil {
		log.Printf("[deletion_log] Virhe savepointin vapautuksessa (%s, ids=%v): %v", tableName, ids, err)
	}
}
