// new_column_defaults.go
// Initializes added columns from the dataset's text-language default.
// Joins modify-columns transactions to canonical column metadata.
// Existing column values and explicit language settings are never rewritten.
package dtt_crud_workflows

import (
	"easelect/backend/core_components/dbutils"
	columns "easelect/backend/core_components/dynamic_table_tools/dtt_2_column_crud"
	"fmt"
	"sort"
	"strings"
)

func supportsColumnLanguages(dataType string) bool {
	kind, suffix, ok := splitAllowedBaseType(dataType)
	return ok && (kind == "TEXT" || kind == "VARCHAR") && isAllowedTypeSuffix(suffix)
}

func validateNewColumnLanguages(added []columns.ModifiedCol) error {
	for _, column := range added {
		if column.IsMultilingual != nil && *column.IsMultilingual && !supportsColumnLanguages(column.DataType) {
			return fmt.Errorf("column %q: multilingual values require a text column", column.NewName)
		}
	}
	return nil
}

// createdColumnsForLanguageDefaults lists a brand-new dataset's columns in the
// shape the language default understands. The order is fixed so one creation
// always writes its metadata the same way.
func createdColumnsForLanguageDefaults(created map[string]string) []columns.ModifiedCol {
	names := make([]string, 0, len(created))
	for name := range created {
		names = append(names, name)
	}
	sort.Strings(names)
	listed := make([]columns.ModifiedCol, 0, len(names))
	for _, name := range names {
		listed = append(listed, columns.ModifiedCol{NewName: name, DataType: created[name]})
	}
	return listed
}

func configureNewColumnDefaults(q dbutils.Querier, tableName string, added []columns.ModifiedCol, defaultLanguages *bool) error {
	if len(added) == 0 && defaultLanguages == nil {
		return nil
	}
	var tableUID int
	var inherited bool
	err := q.QueryRow(`
        SELECT dt.table_uid, COALESCE(dt.new_columns_multilingual, EXISTS (
            SELECT 1 FROM system_column_details source
            WHERE source.table_uid = dt.table_uid AND source.is_multilingual
        ))
        FROM system_db_tables dt
        WHERE dt.schema_name = current_schema() AND dt.table_name = $1
        FOR UPDATE OF dt
    `, strings.ToLower(tableName)).Scan(&tableUID, &inherited)
	if err != nil {
		return fmt.Errorf("load dataset language default: %w", err)
	}
	if defaultLanguages != nil {
		inherited = *defaultLanguages
		if _, err := q.Exec(`UPDATE system_db_tables
            SET new_columns_multilingual = $1, updated = NOW()
            WHERE table_uid = $2`, inherited, tableUID); err != nil {
			return fmt.Errorf("save dataset language default: %w", err)
		}
	}
	for _, column := range added {
		multilingual := supportsColumnLanguages(column.DataType) && inherited
		if column.IsMultilingual != nil {
			multilingual = *column.IsMultilingual
		}
		result, err := q.Exec(`
            UPDATE system_column_details SET is_multilingual = $1, updated = NOW()
            WHERE table_uid = $2 AND column_name = $3
        `, multilingual, tableUID, strings.ToLower(column.NewName))
		if err != nil {
			return fmt.Errorf("initialize column languages: %w", err)
		}
		count, err := result.RowsAffected()
		if err != nil || count != 1 {
			return fmt.Errorf("new column metadata missing: %q", column.NewName)
		}
	}
	return nil
}
