// refresh_row_vector.go
// Refreshes the full-text search vector for a single row after it is created or updated.
// Computes the updated tsvector value and writes it to the search index column.
// Exists to keep per-row search results current without rebuilding an entire dataset.
package dtt_search_vectors

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	"easelect/backend/core_components/dbutils"
	"github.com/lib/pq"
)

// rowVectorUpdater describes the subset of *sql.Tx methods used by RefreshRowSearchVector.
type rowVectorUpdater interface {
	Query(query string, args ...interface{}) (*sql.Rows, error)
	QueryContext(ctx context.Context, query string, args ...interface{}) (*sql.Rows, error)
	ExecContext(ctx context.Context, query string, args ...interface{}) (sql.Result, error)
}

var (
	filteredColumnsFunc          = dbutils.GetQueryableColumns
	searchVectorColumnExistsFunc = searchVectorColumnExists
)

// RefreshRowSearchVector recalculates search_vector_simple for the given row if the column exists.
// It reuses the provided transaction and context instead of opening a new connection.
func RefreshRowSearchVector(ctx context.Context, execer rowVectorUpdater, table string, rowID int64) error {
	if execer == nil {
		return fmt.Errorf("nil executor")
	}
	if strings.TrimSpace(table) == "" {
		return fmt.Errorf("empty table name")
	}
	if rowID <= 0 {
		return fmt.Errorf("invalid row id: %d", rowID)
	}
	schema, plainTable := splitTableName(table)

	exists, err := searchVectorColumnExistsFunc(ctx, execer, schema, plainTable)
	if err != nil {
		return fmt.Errorf("check search_vector_simple column: %w", err)
	}
	if !exists {
		return nil
	}

	cols, err := filteredColumnsFunc(table, execer, false)
	if err != nil {
		return fmt.Errorf("get filtered columns: %w", err)
	}
	if len(cols) == 0 {
		return nil
	}

	var parts []string
	for _, c := range cols {
		parts = append(parts, fmt.Sprintf("coalesce(%s::text,'')", pq.QuoteIdentifier(c)))
	}
	concat := strings.Join(parts, " || ' ' || ")
	update := fmt.Sprintf(`UPDATE %s SET search_vector_simple = to_tsvector('simple', %s) WHERE id = $1`, pq.QuoteIdentifier(table), concat)
	if _, err := execer.ExecContext(ctx, update, rowID); err != nil {
		return fmt.Errorf("update search_vector_simple: %w", err)
	}
	return nil
}

func splitTableName(input string) (schema, name string) {
	schema = "public"
	name = input
	if strings.Contains(input, ".") {
		parts := strings.SplitN(input, ".", 2)
		schema = parts[0]
		name = parts[1]
	}
	return
}

func searchVectorColumnExists(ctx context.Context, execer rowVectorUpdater, schema, table string) (bool, error) {
	const checkQuery = `
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema = $1
                  AND table_name = $2
                  AND column_name = 'search_vector_simple'
                LIMIT 1`
	rows, err := execer.QueryContext(ctx, checkQuery, schema, table)
	if err != nil {
		return false, err
	}
	defer rows.Close()
	if rows.Next() {
		return true, rows.Err()
	}
	return false, rows.Err()
}
