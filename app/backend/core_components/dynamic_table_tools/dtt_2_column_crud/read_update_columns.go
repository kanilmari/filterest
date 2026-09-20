// read_update_columns.go
// Reads and updates column definitions for dynamic tables. Provides handlers that fetch current
// column configuration and apply user-requested modifications.
// Exists to keep column inspection and update payload handling in the dynamic-table API.
package dtt_2_column_crud

import (
	"database/sql"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/httpresponse"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
)

const tableColumnsWithTypesAndIDsQuery = `
        SELECT cd.column_uid, cd.column_name,
               CASE
                   WHEN c.data_type = 'numeric' THEN COALESCE(
                       pg_catalog.format_type(type_column.atttypid, type_column.atttypmod),
                       c.data_type
                   )
                   ELSE c.data_type
               END AS data_type,
               cd.co_number,
               COALESCE(cd.card_element, ''),
               c.character_maximum_length,
               COALESCE(cd.is_multilingual, FALSE),
               COALESCE(dt.new_columns_multilingual, EXISTS (
                   SELECT 1 FROM system_column_details source
                   WHERE source.table_uid = dt.table_uid AND source.is_multilingual
               ))
        FROM system_column_details cd
        JOIN system_db_tables dt ON dt.table_uid = cd.table_uid
        JOIN information_schema.columns c
          ON c.table_name = $1 AND c.column_name = cd.column_name AND c.table_schema = current_schema()
        LEFT JOIN pg_catalog.pg_namespace type_schema
          ON type_schema.nspname = c.table_schema
        LEFT JOIN pg_catalog.pg_class type_table
          ON type_table.relnamespace = type_schema.oid
          AND type_table.relname = c.table_name
        LEFT JOIN pg_catalog.pg_attribute type_column
          ON type_column.attrelid = type_table.oid
          AND type_column.attname = c.column_name
          AND type_column.attnum > 0
          AND NOT type_column.attisdropped
        WHERE cd.table_uid = $2
        ORDER BY cd.co_number
    `

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
        WHERE table_name = $1 AND schema_name = current_schema()
    `, tableName).Scan(&tableUID)
	if err != nil {
		return nil, fmt.Errorf("read_update_columns: error fetching table_uid for table %s: %v", tableName, err)
	}

	// Hae saraketiedot liittymällä system_column_details ja information_schema.columns
	rows, err := backend.Db.Query(tableColumnsWithTypesAndIDsQuery, tableName, tableUID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var columns []map[string]interface{}
	for rows.Next() {
		var (
			columnUid              int
			columnName             string
			dataType               string
			coNumber               int
			cardElement            string
			maximumLength          sql.NullInt64
			isMultilingual         bool
			newColumnsMultilingual bool
		)
		if err := rows.Scan(&columnUid, &columnName, &dataType, &coNumber, &cardElement, &maximumLength, &isMultilingual, &newColumnsMultilingual); err != nil {
			return nil, err
		}
		// The dataset's editing dialog shows a column's stored presentation role
		// and, for limited text, its length. Without them the dialog showed a
		// default and described the dataset wrongly.
		columnInfo := map[string]interface{}{
			"column_uid":               columnUid,
			"column_name":              columnName,
			"data_type":                dataType,
			"card_element":             cardElement,
			"character_maximum_length": nil,
			"is_multilingual":          isMultilingual,
			"new_columns_multilingual": newColumnsMultilingual,
			"co_number":                coNumber, // ( = column order number )
		}
		if maximumLength.Valid {
			columnInfo["character_maximum_length"] = maximumLength.Int64
		}
		columns = append(columns, columnInfo)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return columns, nil
}
