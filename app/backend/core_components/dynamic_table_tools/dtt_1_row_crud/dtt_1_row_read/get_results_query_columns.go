// get_results_query_columns.go
// Limits user sort/filter references to known columns with viewer SELECT grants.
// Connects handler-owned permissions to SQL builders and generated FK label sources.
// Keeps projection metadata intact and ignores unproven query columns without errors.
package dtt_1_row_read

import dtt_models "easelect/backend/core_components/dynamic_table_tools/dtt_models"

func queryColumnIsReadable(name string, columns map[string]dtt_models.ColumnInfo, expressions map[string]string, allowed map[string]bool) bool {
	if _, known := columns[name]; known {
		return allowed[name]
	}
	if _, known := expressions[name]; !known {
		return false
	}
	// Label aliases use the same naming function as the JOIN builder. They
	// inherit the source key's grant, never a grant on the generated name.
	// If sources share an alias, require all of them to be readable.
	foundSource := false
	for source := range columns {
		if generatedForeignNameAlias(source) == name {
			if !allowed[source] {
				return false
			}
			foundSource = true
		}
	}
	return foundSource
}

func readableSortColumns(columns map[string]dtt_models.ColumnInfo, allowed map[string]bool) map[string]dtt_models.ColumnInfo {
	readable := make(map[string]dtt_models.ColumnInfo, len(columns))
	for name, column := range columns {
		if allowed[name] {
			readable[name] = column
		}
	}
	return readable
}
