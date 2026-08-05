// export_table_csv.go
// CSV export helpers that stream one table out of the database into a downloadable file.
// Bridges dev-tool HTTP requests, queryable-column discovery, and filesystem CSV writes.
// Exists to support local backups, migrations, and table-level inspection without manual SQL.
package devtools

import (
	"context"
	"easelect/backend/core_components/httpresponse"
	"encoding/csv"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/security"

	"github.com/lib/pq"
)

// ExportTableCSVToFile exports a table to tables_data/<table>.csv and returns the file path and used table name.
func ExportTableCSVToFile(ctx context.Context, tableName string) (string, string, error) {
	if tableName == "" {
		tableName = "dev_todo"
	}

	sanitizedTableName, err := security.SanitizeIdentifier(tableName)
	if err != nil {
		return "", "", err
	}

	dir := filepath.Join(".", "tables_data")
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", "", fmt.Errorf("error creating dir: %v", err)
	}

	filePath := filepath.Join(dir, tableName+".csv")
	f, err := os.Create(filePath)
	if err != nil {
		return "", "", fmt.Errorf("error creating csv: %v", err)
	}
	defer f.Close()

	writer := csv.NewWriter(f)
	defer writer.Flush()

	tx, ok := dbutils.GetTx(ctx)
	if !ok {
		return "", "", fmt.Errorf("transaction missing from context")
	}

	cols, err := dbutils.GetQueryableColumns(sanitizedTableName, tx, false)
	if err != nil {
		return "", "", fmt.Errorf("error fetching columns: %v", err)
	}
	if len(cols) == 0 {
		return "", "", fmt.Errorf("no columns to export")
	}

	quotedCols := make([]string, len(cols))
	for i, c := range cols {
		quotedCols[i] = pq.QuoteIdentifier(c)
	}
	query := fmt.Sprintf("SELECT %s FROM %s", strings.Join(quotedCols, ","), pq.QuoteIdentifier(sanitizedTableName))
	if sanitizedTableName == "dev_todo" {
		query += " WHERE status=1 AND serlog_mvp=true ORDER BY id"
	}
	rows, err := tx.Query(query)
	if err != nil {
		return "", "", fmt.Errorf("error querying table: %v", err)
	}
	defer rows.Close()

	if err := writer.Write(cols); err != nil {
		return "", "", fmt.Errorf("error writing header: %v", err)
	}

	values := make([]interface{}, len(cols))
	ptrs := make([]interface{}, len(cols))
	for i := range values {
		ptrs[i] = &values[i]
	}
	for rows.Next() {
		if err := rows.Scan(ptrs...); err != nil {
			return "", "", fmt.Errorf("error scanning row: %v", err)
		}
		record := make([]string, len(cols))
		for i, v := range values {
			if t, ok := v.(time.Time); ok {
				record[i] = t.Format(time.RFC3339Nano)
			} else if b, ok := v.([]byte); ok {
				record[i] = string(b)
			} else if v != nil {
				record[i] = fmt.Sprint(v)
			} else {
				record[i] = ""
			}
		}
		if err := writer.Write(record); err != nil {
			return "", "", fmt.Errorf("error writing row: %v", err)
		}
	}

	return filePath, sanitizedTableName, nil
}

// ExportTableCSVHandler exports the requested table and returns the generated file path as plain text.
func ExportTableCSVHandler(w http.ResponseWriter, r *http.Request) {
	tableName := r.URL.Query().Get("dataset")
	filePath, usedTable, err := ExportTableCSVToFile(r.Context(), tableName)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, err.Error())
		return
	}

	w.Header().Set("Content-Type", "text/plain")
	fmt.Fprintf(w, "exported %s to %s", usedTable, filePath)
}
