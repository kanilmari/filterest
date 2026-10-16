// create_table_card_roles.go
// Validates the card roles a dataset change carries and assigns them in the
// same transaction. Creation checks its roles with its ordered column list
// (create_table_column_list.go). A column without a role keeps the metadata
// defaults chosen once by InitialCardRoles.
package dtt_crud_workflows

import (
	"easelect/backend/core_components/dbutils"
	dtt_3_table_create "easelect/backend/core_components/dynamic_table_tools/dtt_3_table_crud/dtt_3_table_create"
	"easelect/frontend/shared/card_roles"
	"fmt"
	"strings"
)

// validateCardRoleValues checks the roles themselves, for a request that does
// not carry the dataset's full column list.
func validateCardRoleValues(roles map[string]string) error {
	for column, role := range roles {
		if strings.TrimSpace(column) == "" {
			return fmt.Errorf("card role refers to an unnamed column")
		}
		if len(role) > 255 || !card_roles.IsValid(role) {
			return fmt.Errorf("unsupported card role for column %q", column)
		}
	}
	return nil
}

func applyColumnCardRoles(q dbutils.Querier, tableName string, roles map[string]string) error {
	return dtt_3_table_create.ApplyColumnCardRoles(q, tableName, roles)
}
