// add_row_ownership.go
// Applies metadata-owned actor fields during dynamic row creation.
// Bridges column insertability metadata and the authenticated session identity.
// Exists so add-row forms never ask users to type their own numeric owner ID.
package dtt_1_row_create

import (
	"easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/row_mutation_policy"
	dtt_models "easelect/backend/core_components/dynamic_table_tools/dtt_models"
)

// isAddRowColumnUserInsertable reports whether a column may be shown in and
// accepted from the add-row form. Missing metadata preserves legacy behavior.
func isAddRowColumnUserInsertable(column dtt_models.AddRowColumnInfo) bool {
	return !column.Insertable.Valid || column.Insertable.Bool
}

// applyCurrentActorOwnership stamps marked actors regardless of insertability.
// Legacy non-insertable user_id and cached_username fields retain their rule.
func applyCurrentActorOwnership(
	filteredRow map[string]interface{},
	columns []dtt_models.AddRowColumnInfo,
	currentUserID int,
	currentUsername string,
	marks row_mutation_policy.RowActorColumns,
) {
	for _, column := range columns {
		if isAddRowColumnUserInsertable(column) {
			continue
		}

		switch column.ColumnName {
		case "user_id":
			filteredRow[column.ColumnName] = currentUserID
		case "cached_username":
			filteredRow[column.ColumnName] = currentUsername
		}
	}
	for column := range marks {
		filteredRow[column] = nil
		if currentUserID > 1 {
			filteredRow[column] = currentUserID
		}
	}
}
