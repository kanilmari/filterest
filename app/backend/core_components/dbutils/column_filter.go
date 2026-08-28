// column_filter.go
// Utilities for filtering database columns based on their data types.
// Used to exclude complex or non-serializable types such as geometry and vector
// columns from standard dynamic-table queries and result sets.
package dbutils

import (
	"database/sql"
	"fmt"
	"strings"

	"github.com/lib/pq"
)

type queryer interface {
	Query(query string, args ...interface{}) (*sql.Rows, error)
}

var excludedUDTNames = []string{"geometry", "geography", "point", "vector"}

// GetQueryableColumns returns column names for the given table.
// If textOnly is true, only text and varchar columns are returned.
// Otherwise geometry/vector/position columns are excluded.
func GetQueryableColumns(table string, db queryer, textOnly bool) ([]string, error) {
	if strings.TrimSpace(table) == "" {
		return nil, fmt.Errorf("empty table name")
	}

	schema := "public"
	if strings.Contains(table, ".") {
		parts := strings.SplitN(table, ".", 2)
		schema = parts[0]
		table = parts[1]
	}

	var query string
	if textOnly {
		query = `
           SELECT column_name
           FROM information_schema.columns
           WHERE table_name = $1
             AND table_schema = $2
             AND data_type IN ('text','character varying')
           ORDER BY ordinal_position`
	} else {
		query = `
           SELECT column_name
           FROM information_schema.columns
           WHERE table_name = $1
             AND table_schema = $2
             AND udt_name <> ALL($3)
             AND udt_name <> 'tsvector'
             AND column_name NOT IN ('embedding_vector', 'position')
           ORDER BY ordinal_position`
	}

	var rows *sql.Rows
	var err error
	if textOnly {
		rows, err = db.Query(query, table, schema)
	} else {
		rows, err = db.Query(query, table, schema, pq.Array(excludedUDTNames))
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var cols []string
	for rows.Next() {
		var columnName string
		if scanErr := rows.Scan(&columnName); scanErr != nil {
			return nil, scanErr
		}
		cols = append(cols, columnName)
	}
	return cols, rows.Err()
}
