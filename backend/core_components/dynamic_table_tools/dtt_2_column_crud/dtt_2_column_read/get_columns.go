// get_columns.go
// Retrieves column metadata for a given dataset from system_column_details
// joined with information_schema. Falls back to information_schema alone
// for database views not registered in system_db_tables.

package dtt_2_column_read

import (
	"database/sql"
	backend "easelect/backend/core_components"
	dtt_models "easelect/backend/core_components/dynamic_table_tools/dtt_models"
	"fmt"
)

// Päivitetty GetColumnsMapForTable-funktio
func GetColumnsMapForTable(datasetName string) (map[int]dtt_models.ColumnInfo, error) {
	// Hae table_uid system_db_tables-taulusta
	var tableUID int
	err := backend.Db.QueryRow(`
        SELECT table_uid
        FROM system_db_tables
        WHERE table_name = $1
    `, datasetName).Scan(&tableUID)
	if err != nil {
		if err == sql.ErrNoRows {
			// Jos kyseessä on näkymä eikä merkintää ole system_db_tables-taulussa,
			// haetaan saraketiedot pelkästään information_schema.columns -taulusta.
			query := `
                        SELECT ordinal_position, column_name, data_type, is_nullable, is_identity, column_default
                        FROM information_schema.columns
                        WHERE table_schema = 'public' AND table_name = $1
                        ORDER BY ordinal_position`
			rows, err2 := backend.Db.Query(query, datasetName)
			if err2 != nil {
				return nil, fmt.Errorf("get_columns: info_schema query for view %s: %v", datasetName, err2)
			}
			defer rows.Close()

			columnsMap := make(map[int]dtt_models.ColumnInfo)
			idx := 1
			for rows.Next() {
				var col dtt_models.ColumnInfo
				var colDefault sql.NullString
				if err := rows.Scan(
					&col.CoNumber,
					&col.ColumnName,
					&col.DataType,
					&col.IsNullable,
					&col.IsIdentity,
					&colDefault,
				); err != nil {
					return nil, fmt.Errorf("get_columns: scan error for view %s: %v", datasetName, err)
				}
				col.ColumnDefault = colDefault
				col.ColumnUid = idx
				col.CardElement = ""
				columnsMap[col.ColumnUid] = col
				idx++
			}
			return columnsMap, nil
		}
		return nil, fmt.Errorf("get_columns: error fetching table_uid for table %s: %v", datasetName, err)
	}

	// Hae saraketiedot liittymällä system_column_details ja information_schema.columns
	query := `
       SELECT cd.column_uid,
              cd.column_name,
              c.data_type,
              cd.co_number,
              c.is_nullable,
              c.is_identity,
              c.column_default,
              COALESCE(cd.card_element, '') AS card_element,
              COALESCE(cd.is_multilingual, false) AS is_multilingual
       FROM system_column_details cd
       JOIN information_schema.columns c
         ON c.table_name = $1 AND c.column_name = cd.column_name
       WHERE cd.table_uid = $2
         AND COALESCE(cd.hide_everywhere, false) = false
         AND cd.column_name NOT IN ('embedding_vector', 'search_vector_simple')
       ORDER BY cd.co_number
   `
	rows, err := backend.Db.Query(query, datasetName, tableUID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	columnsMap := make(map[int]dtt_models.ColumnInfo)
	for rows.Next() {
		var colInfo dtt_models.ColumnInfo
		if err := rows.Scan(
			&colInfo.ColumnUid,
			&colInfo.ColumnName,
			&colInfo.DataType,
			&colInfo.CoNumber,
			&colInfo.IsNullable,
			&colInfo.IsIdentity,
			&colInfo.ColumnDefault,
			&colInfo.CardElement,
			&colInfo.IsMultilingual,
		); err != nil {
			return nil, err
		}
		columnsMap[colInfo.ColumnUid] = colInfo
	}
	return columnsMap, nil
}

// GetColumnsForTable hakee taulun sarakkeiden nimet
func GetColumnsForDataset(datasetName string) ([]string, error) {
	query := `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position
    `
	rows, err := backend.Db.Query(query, datasetName)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var columns []string
	for rows.Next() {
		var columnName string
		if err := rows.Scan(&columnName); err != nil {
			return nil, err
		}
		columns = append(columns, columnName)
	}
	return columns, nil
}

func GetColumnIDsForTableUID(tableUID int) ([]int, error) {
	query := `
        SELECT column_uid
        FROM system_column_details
        WHERE table_uid = $1
        ORDER BY co_number
    `
	rows, err := backend.Db.Query(query, tableUID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var columnIDs []int
	for rows.Next() {
		var columnID int
		if err := rows.Scan(&columnID); err != nil {
			return nil, err
		}
		columnIDs = append(columnIDs, columnID)
	}
	return columnIDs, nil
}
