// create_table_card_roles.go
// Validates optional card roles before dataset creation and assigns metadata in
// the same transaction. Existing callers retain the metadata default, details.
package dtt_crud_workflows

import (
	"easelect/backend/core_components/dbutils"
	"easelect/frontend/shared/card_roles"
	"fmt"
	"sort"
	"strings"
)

func validateCreationCardRoles(roles, columns map[string]string) error {
	for column, role := range roles {
		if _, exists := columns[column]; !exists {
			return fmt.Errorf("card role refers to unknown column %q", column)
		}
		if len(role) > 255 || !card_roles.IsValid(role) {
			return fmt.Errorf("unsupported card role for column %q", column)
		}
	}
	return nil
}

func applyCreationCardRoles(q dbutils.Querier, tableName string, roles map[string]string) error {
	columns := make([]string, 0, len(roles))
	for column := range roles {
		columns = append(columns, column)
	}
	sort.Strings(columns)
	for _, column := range columns {
		role := strings.TrimSpace(roles[column])
		if role == "" {
			continue
		}
		var initialShowKey interface{}
		if value, defined := card_roles.InitialShowKey(role); defined {
			initialShowKey = value
		}
		result, err := q.Exec(`
            UPDATE system_column_details AS cd
            SET card_element = $1, show_key_on_card = COALESCE($2, cd.show_key_on_card), updated = NOW()
            FROM system_db_tables AS dt
            WHERE cd.table_uid = dt.table_uid
              AND dt.schema_name = current_schema()
              AND dt.table_name = $3 AND cd.column_name = $4
        `, role, initialShowKey, strings.ToLower(tableName), strings.ToLower(column))
		if err != nil {
			return fmt.Errorf("assign card role: %w", err)
		}
		count, err := result.RowsAffected()
		if err != nil || count != 1 {
			return fmt.Errorf("card role assignment must match one column: %q", column)
		}
	}
	return nil
}
