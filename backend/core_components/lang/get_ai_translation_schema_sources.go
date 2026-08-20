// get_ai_translation_schema_sources.go
// Reads schema-backed translation-key source evidence used by the AI translation handler.
// Bridges column/table metadata and the existing source-classification workflow.
// Exists separately to keep the main translation handler within the repository size boundary.
package lang

import (
	"log"

	backend "easelect/backend/core_components"
)

// fetchColumnToTables hakee sarake→taulut -mappauksen.
// Palauttaa: {"created": ["app_service_catalog", "system_users", ...], ...}
func fetchColumnToTables() map[string][]string {
	result := make(map[string][]string)
	rows, err := backend.Db.Query(`
		SELECT cd.column_name, dt.table_name
		FROM system_column_details cd
		JOIN system_db_tables dt ON cd.table_uid = dt.table_uid
		ORDER BY cd.column_name, dt.table_name
	`)
	if err != nil {
		log.Printf("[fetchColumnToTables] error: %v", err)
		return result
	}
	defer rows.Close()
	for rows.Next() {
		var colName, tableName string
		if err := rows.Scan(&colName, &tableName); err == nil {
			result[colName] = append(result[colName], tableName)
		}
	}
	if err := rows.Err(); err != nil {
		log.Printf("[fetchColumnToTables] rows iteration error: %v", err)
	}
	return result
}

// fetchTableNames hakee kaikki taulunimet tietokannasta skeema-avainten tunnistamista varten.
func fetchTableNames() map[string]bool {
	result := make(map[string]bool)
	rows, err := backend.Db.Query("SELECT DISTINCT table_name FROM system_db_tables")
	if err != nil {
		log.Printf("[fetchTableNames] error: %v", err)
		return result
	}
	defer rows.Close()
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err == nil && name != "" {
			result[name] = true
		}
	}
	if err := rows.Err(); err != nil {
		log.Printf("[fetchTableNames] rows iteration error: %v", err)
	}
	return result
}
