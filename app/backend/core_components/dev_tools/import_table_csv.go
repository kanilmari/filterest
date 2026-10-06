// import_table_csv.go
// CSV import helpers that read table dumps from the resolved mutable runtime area.
// Bridges dev-tool HTTP requests, sanitized table metadata, and transactional bulk writes.
// Exists to restore development data without reading state beside immutable app source.
package devtools

import (
	"context"
	"database/sql"
	"easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/row_mutation_policy"
	"encoding/csv"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/httpresponse"
	lang "easelect/backend/core_components/lang"
	"easelect/backend/core_components/security"
	e_sessions "easelect/backend/core_components/sessions"
	"easelect/backend/core_components/system_config_checks"

	"github.com/lib/pq"
)

// retiredCSVColumns is the small, table-specific compatibility list for old
// exports. Only deliberately removed metadata is skipped; other headers still
// reach PostgreSQL, which rejects unknown columns. Exports use the live schema.
var retiredCSVColumns = map[string]map[string]bool{
	"system_column_details": {"label_value_layout": true}, // WL52, DB 9.10.0.
}

// ImportTableCSV reads the resolved tables_data/<table>.csv using the transaction from ctx
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
func ImportTableCSVTxWithUsername(tx *sql.Tx, tableName string, username string, actorRepairs ...*CSVActorRepairCounts) (string, string, error) {
	if tableName == "" {
		tableName = "dev_todo"
	}

	sanitizedTable, err := security.SanitizeIdentifier(tableName)
	if err != nil {
		return "", "", err
	}

	filePath := tableCSVFilePath(sanitizedTable)
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

	cols := make([]string, 0, len(headers))
	sourceIndexes := make([]int, 0, len(headers))
	for i, h := range headers {
		sanitized, err := security.SanitizeIdentifier(h)
		if err != nil {
			return "", "", fmt.Errorf("bad column name '%s': %v", h, err)
		}
		if retiredCSVColumns[sanitizedTable][sanitized] {
			continue
		}
		cols = append(cols, sanitized)
		sourceIndexes = append(sourceIndexes, i)
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
	if tx == nil {
		return "", "", fmt.Errorf("tx is nil")
	}
	marks, err := row_mutation_policy.ReadRowActorColumns(tx, sanitizedTable)
	if err != nil {
		return "", "", err
	}
	repairs := CSVActorRepairCounts{}
	knownUsers := make(map[int64]bool)

	placeholders := make([]string, len(cols))
	quotedCols := make([]string, len(cols))
	updateParts := []string{}
	for i, col := range cols {
		placeholders[i] = fmt.Sprintf("$%d", i+1)
		quotedCols[i] = pq.QuoteIdentifier(col)
		if col != "id" && col != "created" && col != "updated" && marks[col] == "" {
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

	pictures, err := newCSVPictureRestore(tx, sanitizedTable, cols)
	if err != nil {
		return "", "", err
	}
	if pictures.active() {
		query += ` RETURNING id, (xmax = 0)`
	}
	if sanitizedTable == "system_config" {
		// A partial upsert can name only id and json_value. Lock out concurrent
		// inserts too, so a missing id cannot become a registered row between
		// its candidate check and ON CONFLICT. Row locks cover existing ids.
		if _, err := tx.Exec(`LOCK TABLE public.system_config IN SHARE ROW EXCLUSIVE MODE`); err != nil {
			return "", "", err
		}
	}

	for {
		sourceRecord, err := reader.Read()
		if err != nil {
			if err.Error() == "EOF" {
				break
			}
			return "", "", fmt.Errorf("error reading row: %v", err)
		}

		record := make([]string, len(cols))
		for i, sourceIndex := range sourceIndexes {
			record[i] = sourceRecord[sourceIndex]
		}
		vals := make([]interface{}, len(record))
		for i, v := range record {
			if v == "" {
				vals[i] = nil
			} else {
				vals[i] = v
			}
			if role := marks[cols[i]]; role != "" && vals[i] != nil {
				value, cleared, err := normalizeCSVActorValue(tx, v, knownUsers)
				if err != nil {
					return "", "", err
				}
				vals[i] = value
				if cleared {
					if role == "creator" {
						repairs.Creator++
					} else {
						repairs.Owner++
					}
				}
			}
		}

		settingRow := make(map[string]interface{}, len(cols))
		for index, column := range cols {
			settingRow[column] = vals[index]
		}
		if err := system_config_checks.ValidateInsert(tx, sanitizedTable, settingRow); err != nil {
			return "", "", err
		}

		if pictures.active() {
			plan, err := pictures.beforeRow(tx, record, vals)
			if err != nil {
				return "", "", fmt.Errorf("error preparing the card picture of a row: %v", err)
			}
			var rowID int64
			var inserted bool
			err = tx.QueryRow(query, vals...).Scan(&rowID, &inserted)
			if err == sql.ErrNoRows {
				// ON CONFLICT DO NOTHING: the row exists and was left as it is.
				continue
			}
			if err != nil {
				return "", "", fmt.Errorf("error inserting row: %v", err)
			}
			if err := pictures.afterRow(tx, rowID, inserted, plan); err != nil {
				return "", "", fmt.Errorf("error applying the card picture rule: %v", err)
			}
		} else if _, err := tx.Exec(query, vals...); err != nil {
			return "", "", fmt.Errorf("error inserting row: %v", err)
		}
		if langKeyColumnIndex >= 0 && langKeyColumnIndex < len(record) {
			importedLangKeys = append(importedLangKeys, record[langKeyColumnIndex])
		}
	}

	if len(importedLangKeys) > 0 {
		lang.EnsureLangKeySourcesForCRUDImportTx(tx, sanitizedTable, importedLangKeys, username)
	}

	for _, result := range actorRepairs {
		if result != nil {
			*result = repairs
		}
	}
	return filePath, sanitizedTable, nil
}

// ImportTableCSVHandler handles the HTTP-triggered CSV import flow for one requested dataset.
func ImportTableCSVHandler(w http.ResponseWriter, r *http.Request) {
	// This handler changes stored data, so it must not answer a read. A read
	// method is also how the site assistant reaches a route without asking
	// anyone to approve the change, because approval is only required of
	// writes.

	tableName := r.URL.Query().Get("dataset")
	tx, ok := dbutils.GetTx(r.Context())
	if !ok {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "transaction missing")
		return
	}

	username := getImportUsernameOrUnknown(r)
	var actorRepairs CSVActorRepairCounts
	filePath, usedTable, err := ImportTableCSVTxWithUsername(tx, tableName, username, &actorRepairs)
	if err != nil {
		var refusal *httpresponse.Refusal
		if errors.As(err, &refusal) {
			httpresponse.RespondWithRefusal(w, refusal)
			return
		}
		httpresponse.RespondWithError(w, http.StatusInternalServerError, err.Error())
		return
	}

	w.Header().Set("Content-Type", "text/plain")
	fmt.Fprintf(w, "imported %s from %s; actor references cleared: creator=%d, owner=%d",
		usedTable, filePath, actorRepairs.Creator, actorRepairs.Owner)
}

// getImportUsernameOrUnknown names the signed-in user for import-side provenance
// writes: the current display name, read by the session's user id (the session
// carries no name), or "unknown".
func getImportUsernameOrUnknown(request *http.Request) string {
	userID, err := e_sessions.GetUserIDFromSession(request)
	if err != nil {
		return "unknown"
	}
	return backend.UserDisplayNameOr(request.Context(), backend.Db, userID, "unknown")
}
