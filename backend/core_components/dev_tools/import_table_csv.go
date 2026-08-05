// import_table_csv.go
// CSV import helpers that read a table dump file and upsert its rows into the database.
// Bridges dev-tool HTTP requests, sanitized table metadata, and transactional bulk writes.
// Exists to support local seed loading and repeatable table restoration during development.
package devtools

import (
	"context"
	"database/sql"
	"encoding/csv"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/httpresponse"
	lang "easelect/backend/core_components/lang"
	"easelect/backend/core_components/security"
	e_sessions "easelect/backend/core_components/sessions"

	"github.com/lib/pq"
)

// ImportTableCSV reads tables_data/<table>.csv using the transaction from ctx
// and upserts rows into the database. It returns an error if the transaction is
// missing.
func ImportTableCSV(ctx context.Context, tableName string) (string, string, error) {
	tx, ok := dbutils.GetTx(ctx)
	if !ok {
		return "", "", fmt.Errorf("transaction missing from context")
	}

	return ImportTableCSVTxWithUsername(tx, tableName, "unknown")
}

// ImportTableCSVTx imports a table dump with a transaction-only API for internal callers and tests.
func ImportTableCSVTx(tx *sql.Tx, tableName string) (string, string, error) {
	return ImportTableCSVTxWithUsername(tx, tableName, "unknown")
}

// ImportTableCSVTxWithUsername imports one CSV file, upserts the rows, and records lang-key provenance when needed.
func ImportTableCSVTxWithUsername(tx *sql.Tx, tableName string, username string) (string, string, error) {
	if tableName == "" {
		tableName = "dev_todo"
	}

	sanitizedTable, err := security.SanitizeIdentifier(tableName)
	if err != nil {
		return "", "", err
	}

	filePath := filepath.Join(".", "tables_data", sanitizedTable+".csv")
	f, err := os.Open(filePath)
	if err != nil {
		return "", "", fmt.Errorf("error opening csv: %v", err)
	}
	defer f.Close()

	reader := csv.NewReader(f)
	headers, err := reader.Read()
	if err != nil {
		return "", "", fmt.Errorf("error reading header: %v", err)
	}

	cols := make([]string, len(headers))
	for i, h := range headers {
		sanitized, err := security.SanitizeIdentifier(h)
		if err != nil {
			return "", "", fmt.Errorf("bad column name '%s': %v", h, err)
		}
		cols[i] = sanitized
	}

	if len(cols) == 0 {
		return "", "", fmt.Errorf("no columns in csv")
	}
	langKeyColumnIndex := -1
	if sanitizedTable == "system_lang_keys" {
		for i, col := range cols {
			if col == "lang_key" {
				langKeyColumnIndex = i
				break
			}
		}
	}
	importedLangKeys := make([]string, 0, 64)

	placeholders := make([]string, len(cols))
	quotedCols := make([]string, len(cols))
	updateParts := []string{}
	for i, col := range cols {
		placeholders[i] = fmt.Sprintf("$%d", i+1)
		quotedCols[i] = pq.QuoteIdentifier(col)
		if col != "id" && col != "created" && col != "updated" {
			updateParts = append(updateParts, fmt.Sprintf("%s = EXCLUDED.%s", pq.QuoteIdentifier(col), pq.QuoteIdentifier(col)))
		}
	}

	var query string
	if len(updateParts) == 0 {
		query = fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s) ON CONFLICT (id) DO NOTHING",
			pq.QuoteIdentifier(sanitizedTable),
			strings.Join(quotedCols, ","),
			strings.Join(placeholders, ","),
		)
	} else {
		query = fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s) ON CONFLICT (id) DO UPDATE SET %s",
			pq.QuoteIdentifier(sanitizedTable),
			strings.Join(quotedCols, ","),
			strings.Join(placeholders, ","),
			strings.Join(updateParts, ","),
		)
	}

	if tx == nil {
		return "", "", fmt.Errorf("tx is nil")
	}

	for {
		record, err := reader.Read()
		if err != nil {
			if err.Error() == "EOF" {
				break
			}
			return "", "", fmt.Errorf("error reading row: %v", err)
		}

		vals := make([]interface{}, len(record))
		for i, v := range record {
			if v == "" {
				vals[i] = nil
			} else {
				vals[i] = v
			}
		}

		if _, err := tx.Exec(query, vals...); err != nil {
			return "", "", fmt.Errorf("error inserting row: %v", err)
		}
		if langKeyColumnIndex >= 0 && langKeyColumnIndex < len(record) {
			importedLangKeys = append(importedLangKeys, record[langKeyColumnIndex])
		}
	}

	if len(importedLangKeys) > 0 {
		lang.EnsureLangKeySourcesForCRUDImportTx(tx, sanitizedTable, importedLangKeys, username)
	}

	return filePath, sanitizedTable, nil
}

// ImportTableCSVHandler handles the HTTP-triggered CSV import flow for one requested dataset.
func ImportTableCSVHandler(w http.ResponseWriter, r *http.Request) {
	tableName := r.URL.Query().Get("dataset")
	tx, ok := dbutils.GetTx(r.Context())
	if !ok {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "transaction missing")
		return
	}

	username := getImportUsernameOrUnknown(r)
	filePath, usedTable, err := ImportTableCSVTxWithUsername(tx, tableName, username)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, err.Error())
		return
	}

	w.Header().Set("Content-Type", "text/plain")
	fmt.Fprintf(w, "imported %s from %s", usedTable, filePath)
}

// getImportUsernameOrUnknown resolves the session username for import-side provenance writes.
func getImportUsernameOrUnknown(request *http.Request) string {
	session, err := e_sessions.GetOrCreateSession(nil, request)
	if err != nil || session == nil {
		return "unknown"
	}

	rawUsername, ok := session.Values["username"]
	if !ok {
		return "unknown"
	}

	username, ok := rawUsername.(string)
	if !ok {
		return "unknown"
	}

	trimmedUsername := strings.TrimSpace(username)
	if trimmedUsername == "" {
		return "unknown"
	}

	return trimmedUsername
}
