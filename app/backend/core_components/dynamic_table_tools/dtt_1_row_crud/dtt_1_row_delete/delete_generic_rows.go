// delete_generic_rows.go
// Deletes only authorized dynamic rows and preserves protected Home settings.
// Connects the final DELETE predicate with exact row counts and deletion logging.
// Rolls back partial deletes so a concurrent first save cannot lose its revision.
package dtt_1_row_delete

import (
	"database/sql"
	"fmt"
	"strings"

	read "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read"
	"easelect/backend/core_components/system_config_checks"
	"github.com/lib/pq"
)

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
	whereClause, args, err = read.AppendMutationRowPolicyToWhereClause(
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
	// Repeat protection on the write: the preflight may have seen an absent
	// setting before a concurrent first save committed its future numeric ID.
	if tableName == "system_config" {
		args = append(args, system_config_checks.FrontPageArticleButtonsKey)
		whereClause += fmt.Sprintf(" AND %s.key IS DISTINCT FROM $%d", quotedTable, len(args))
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
