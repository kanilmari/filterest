// display_column_resolver.go
// Selects the established foreign-key label column from ordered text columns.
// Shared by dynamic row metadata and the runtime grant snapshot.
// Keeps label disclosure and label queries on the same deterministic rule.
package fk_display

import (
	"fmt"
	"strings"
)

// LegacyColumn returns the product's historical label-column exceptions.
func LegacyColumn(tableName string) string {
	tableSpecificNameColumns := map[string]string{
		"system_functions":   "name",
		"system_user_groups": "name",
		"system_db_tables":   "table_name",
	}
	if nameCol, ok := tableSpecificNameColumns[tableName]; ok {
		return nameCol
	}

	return ""
}

// Resolve uses ordinal-order text columns and the existing label priorities.
func Resolve(tableName string, textCols []string) (string, error) {
	if column := LegacyColumn(tableName); column != "" {
		return column, nil
	}
	// 3) Täsmäävät priorisoidut nimet.
	preferredNames := []string{
		"name", "title", "label", "lang_key", "username",
		"display_name", "full_name", "key", "code", "slug",
	}
	for _, preferred := range preferredNames {
		for _, col := range textCols {
			if strings.EqualFold(col, preferred) {
				return col, nil
			}
		}
	}

	// 4) Osittaiset päätteet.
	preferredSuffixes := []string{"_name", "_title", "_label", "_key"}
	for _, suffix := range preferredSuffixes {
		for _, col := range textCols {
			if strings.HasSuffix(strings.ToLower(col), suffix) {
				return col, nil
			}
		}
	}

	// 5) Sisältö-osuma (taaksepäin yhteensopiva).
	nameIndicators := []string{"name", "title", "username", "header"}
	for _, indicator := range nameIndicators {
		for _, col := range textCols {
			if strings.Contains(strings.ToLower(col), indicator) {
				return col, nil
			}
		}
	}

	// 6) Fallback: ensimmäinen text/varchar-sarake.
	if len(textCols) > 0 {
		return textCols[0], nil
	}

	return "", fmt.Errorf("no text/varchar columns found in table %s", tableName)
}
