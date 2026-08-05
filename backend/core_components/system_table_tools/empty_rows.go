// empty_rows.go
// Detects and reports empty rows across dynamic tables.
// Bridges dynamic table metadata and the admin data-quality monitoring endpoint.
// Exists to identify rows where all user-visible columns are null or empty.
package system_table_tools

import (
	"database/sql"
	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dynamic_table_tools/dtt_utils"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"easelect/backend/core_components/httpresponse"
	"strings"

	"github.com/lib/pq"
)

func GetEmptyRowsHandler(w http.ResponseWriter, r *http.Request) {
	tables, err := getAllTableNames()
	if err != nil {
		log.Printf("\033[31merror: fetching tables: %v\033[0m", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "error fetching tables")
		return
	}

	var result []map[string]interface{}
	for _, tbl := range tables {
		rows, cols, err := fetchEmptyRowsForTable(tbl)
		if err != nil {
			log.Printf("\033[31merror: fetching empty rows for table %s: %v\033[0m", tbl, err)
			continue
		}
		if len(rows) > 0 {
			result = append(result, map[string]interface{}{
				"dataset": tbl,
				"columns": cols,
				"rows":    rows,
			})
		}
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(result); err != nil {
		log.Printf("\033[31merror: encoding response: %v\033[0m", err)
	}
}

func getAllTableNames() ([]string, error) {
	query := `SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name`
	rows, err := backend.Db.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var names []string
	for rows.Next() {
		var tableName string
		if err := rows.Scan(&tableName); err != nil {
			return nil, err
		}
		names = append(names, tableName)
	}
	return names, rows.Err()
}

func fetchEmptyRowsForTable(tableName string) ([]map[string]interface{}, []string, error) {
	colQuery := `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`
	colRows, err := backend.Db.Query(colQuery, tableName)
	if err != nil {
		return nil, nil, err
	}
	defer colRows.Close()

	var columns []string
	for colRows.Next() {
		var columnName string
		if err := colRows.Scan(&columnName); err != nil {
			return nil, nil, err
		}
		columns = append(columns, columnName)
	}
	if err := colRows.Err(); err != nil {
		return nil, nil, err
	}

	fkMap, err := dtt_utils.GetForeignKeysForTable(tableName)
	if err != nil && err != sql.ErrNoRows {
		log.Printf("warning: could not fetch foreign keys for %s: %v", tableName, err)
	}

	skip := map[string]bool{"id": true, "created": true, "edited": true, "updated": true}
	for fkCol := range fkMap {
		skip[fkCol] = true
	}
	for _, c := range columns {
		if strings.HasSuffix(c, "_id") || strings.HasSuffix(c, "_uid") {
			skip[c] = true
		}
	}

	var conditions []string
	for _, c := range columns {
		if skip[c] {
			continue
		}
		quoted := pq.QuoteIdentifier(c)
		conditions = append(conditions, fmt.Sprintf("COALESCE(TRIM(CAST(%s AS TEXT)), '') = ''", quoted))
	}

	if len(conditions) == 0 {
		return nil, columns, nil
	}

	query := fmt.Sprintf("SELECT * FROM %s WHERE %s", pq.QuoteIdentifier(tableName), strings.Join(conditions, " AND "))
	rows, err := backend.Db.Query(query)
	if err != nil {
		return nil, columns, err
	}
	defer rows.Close()

	colNames, err := rows.Columns()
	if err != nil {
		return nil, columns, err
	}

	var results []map[string]interface{}
	for rows.Next() {
		values := make([]interface{}, len(colNames))
		ptrs := make([]interface{}, len(colNames))
		for i := range values {
			ptrs[i] = &values[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return nil, columns, err
		}
		rowMap := make(map[string]interface{})
		for i, col := range colNames {
			v := values[i]
			if b, ok := v.([]byte); ok {
				rowMap[col] = string(b)
			} else {
				rowMap[col] = v
			}
		}
		results = append(results, rowMap)
	}
	return results, colNames, rows.Err()
}
