// read_update_columns.go
// Reads and updates column definitions for dynamic tables. Provides handlers that fetch current
// column configuration and apply user-requested modifications.
// Exists to keep column inspection and update payload handling in the dynamic-table API.
package dtt_2_column_crud

import (
	backend "easelect/backend/core_components"
	"easelect/backend/core_components/httpresponse"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
)

func GetTableColumnsHandler(w http.ResponseWriter, r *http.Request) {
	// Oletetaan, että URL-polku on /api/dataset-columns/{table_name}
	tableName := strings.TrimPrefix(r.URL.Path, "/api/dataset-columns/")
	if tableName == "" {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "Table name is required")
		return
	}

	columns, err := GetTableColumnsWithTypesAndIDs(tableName)
	if err != nil {
		log.Printf("\033[31merror: fetching columns: %v\033[0m", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "Error fetching columns")
		return
	}

	// Tulostetaan lokiin jokaisen sarakkeen tiedot
	// for i, c := range columns {
	// 	log.Printf("Sarake %d: %#v", i, c)
	// }

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(columns); err != nil {
		log.Printf("\033[31merror: encoding response: %v\033[0m", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "Error encoding response")
	}
}

// Päivitetty GetTableColumnsWithTypesAndIDs-funktio
func GetTableColumnsWithTypesAndIDs(tableName string) ([]map[string]interface{}, error) {
	// Hae table_uid system_db_tables-taulusta
	var tableUID int
	err := backend.Db.QueryRow(`
        SELECT table_uid
        FROM system_db_tables
        WHERE table_name = $1
    `, tableName).Scan(&tableUID)
	if err != nil {
		return nil, fmt.Errorf("read_update_columns: error fetching table_uid for table %s: %v", tableName, err)
	}

	// Hae saraketiedot liittymällä system_column_details ja information_schema.columns
	query := `
        SELECT cd.column_uid, cd.column_name, c.data_type, cd.co_number
        FROM system_column_details cd
        JOIN information_schema.columns c
          ON c.table_name = $1 AND c.column_name = cd.column_name
        WHERE cd.table_uid = $2
        ORDER BY cd.co_number
    `
	rows, err := backend.Db.Query(query, tableName, tableUID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var columns []map[string]interface{}
	for rows.Next() {
		var (
			columnUid  int
			columnName string
			dataType   string
			coNumber   int
		)
		if err := rows.Scan(&columnUid, &columnName, &dataType, &coNumber); err != nil {
			return nil, err
		}
		columnInfo := map[string]interface{}{
			"column_uid":  columnUid,
			"column_name": columnName,
			"data_type":   dataType,
			"co_number":   coNumber, // ( = column order number )
		}
		columns = append(columns, columnInfo)
	}
	return columns, nil
}
