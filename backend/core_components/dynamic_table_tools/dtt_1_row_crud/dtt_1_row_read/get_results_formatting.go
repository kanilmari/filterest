// get_results_formatting.go
// Converts raw sql.Rows into JSON-compatible structures for the frontend.
// Bridges the database result set and the HTTP response with type-aware formatting.
// Exists to handle special column types (time, embedding, etc.) during result serialisation.
package dtt_1_row_read

import (
	"database/sql"
	"log"
	"strings"
	"time"
)

// formatTemporalColumnValue preserves the semantic contract of each PostgreSQL temporal type.
// DATE and TIMESTAMP remain calendar/wall-clock values; TIMESTAMPTZ is emitted as an explicit UTC instant.
func formatTemporalColumnValue(value time.Time, databaseTypeName string) string {
	switch strings.ToUpper(strings.TrimSpace(databaseTypeName)) {
	case "DATE":
		return value.Format("2006-01-02")
	case "TIMESTAMP", "TIMESTAMP WITHOUT TIME ZONE":
		return value.Format("2006-01-02 15:04:05.999999999")
	case "TIMESTAMPTZ", "TIMESTAMP WITH TIME ZONE":
		return value.UTC().Format(time.RFC3339Nano)
	default:
		return value.Format("2006-01-02 15:04:05")
	}
}

// FormatRowsToMaps iterates over the database rows and formats them into a list of maps.
func FormatRowsToMaps(sqlRows *sql.Rows) ([]string, []map[string]interface{}, error) {
	columnNames, err := sqlRows.Columns()
	if err != nil {
		log.Printf("\033[31merror: %s\033[0m\n", err.Error())
		return nil, nil, err
	}
	columnTypes, err := sqlRows.ColumnTypes()
	if err != nil {
		log.Printf("\033[31merror: %s\033[0m\n", err.Error())
		return nil, nil, err
	}

	formattedRows := make([]map[string]interface{}, 0)
	for sqlRows.Next() {
		rowValues := make([]interface{}, len(columnNames))
		rowPointers := make([]interface{}, len(columnNames))
		for i := range rowValues {
			rowPointers[i] = &rowValues[i]
		}
		if err := sqlRows.Scan(rowPointers...); err != nil {
			log.Printf("\033[31merror: %s\033[0m\n", err.Error())
			return nil, nil, err
		}

		currentRow := make(map[string]interface{})
		for i, colName := range columnNames {
			val := rowValues[i]
			switch typedVal := val.(type) {
			case time.Time:
				databaseTypeName := ""
				if i < len(columnTypes) {
					databaseTypeName = columnTypes[i].DatabaseTypeName()
				}
				currentRow[colName] = formatTemporalColumnValue(typedVal, databaseTypeName)
			case []byte:
				s := string(typedVal)
				if colName == "embedding_vector" && len(s) > 500 {
					s = s[:500] + "..."
				}
				currentRow[colName] = s
			case string:
				s := typedVal
				if colName == "embedding_vector" && len(s) > 500 {
					s = s[:500] + "..."
				}
				currentRow[colName] = s
			default:
				currentRow[colName] = typedVal
			}
		}
		formattedRows = append(formattedRows, currentRow)
	}
	if err := sqlRows.Err(); err != nil {
		log.Printf("\033[31merror: %s\033[0m\n", err.Error())
		return nil, nil, err
	}

	return columnNames, formattedRows, nil
}
