// primary_key_guard.go
// Shared primary key guard helpers for dynamic table mutation workflows.
// They inspect PostgreSQL metadata inside the active transaction so callers
// can block mutations that would leave a table without a primary key.
package dtt_2_column_crud

import (
	"database/sql"
	"fmt"
	"strings"
)

// ErrTableMissingPrimaryKey describes a table state that violates the runtime
// requirement that every mutable table must retain a primary key.
type ErrTableMissingPrimaryKey struct {
	TableName string
}

func (e *ErrTableMissingPrimaryKey) Error() string {
	return fmt.Sprintf("table '%s' must have a primary key", e.TableName)
}

// GetPrimaryKeyColumns returns the lower-cased column names that currently form
// the table's primary key inside the active transaction.
func GetPrimaryKeyColumns(tx *sql.Tx, sanitizedTableName string) (map[string]struct{}, error) {
	query := `
		SELECT a.attname
		FROM pg_constraint con
		JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = ANY(con.conkey)
		WHERE con.conrelid = $1::regclass AND con.contype = 'p'
	`
	rows, err := tx.Query(query, sanitizedTableName)
	if err != nil {
		return nil, fmt.Errorf("error fetching primary key columns: %w", err)
	}
	defer rows.Close()

	pkCols := make(map[string]struct{})
	for rows.Next() {
		var colName string
		if err := rows.Scan(&colName); err != nil {
			return nil, err
		}
		pkCols[strings.ToLower(colName)] = struct{}{}
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}

	return pkCols, nil
}

// EnsureTableHasPrimaryKey confirms that the table still has at least one
// primary key column after an in-flight schema mutation.
func EnsureTableHasPrimaryKey(tx *sql.Tx, sanitizedTableName string) error {
	pkCols, err := GetPrimaryKeyColumns(tx, sanitizedTableName)
	if err != nil {
		return err
	}
	if len(pkCols) == 0 {
		return &ErrTableMissingPrimaryKey{TableName: sanitizedTableName}
	}
	return nil
}