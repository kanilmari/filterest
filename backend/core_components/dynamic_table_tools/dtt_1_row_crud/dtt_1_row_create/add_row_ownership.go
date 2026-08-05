// add_row_ownership.go
// Applies metadata-owned actor fields during dynamic row creation.
// Bridges column insertability metadata and the authenticated session identity.
// Exists so add-row forms never ask users to type their own numeric owner ID.
package dtt_1_row_create

import dtt_models "easelect/backend/core_components/dynamic_table_tools/dtt_models"

// isAddRowColumnUserInsertable reports whether a column may be shown in and
// accepted from the add-row form. Missing metadata preserves legacy behavior.
func isAddRowColumnUserInsertable(column dtt_models.AddRowColumnInfo) bool {
	return !column.Insertable.Valid || column.Insertable.Bool
}

// applyCurrentActorOwnership fills supported non-insertable ownership fields
// from the authenticated session. Other non-insertable fields stay untouched.
func applyCurrentActorOwnership(
	filteredRow map[string]interface{},
	columns []dtt_models.AddRowColumnInfo,
	currentUserID int,
	currentUsername string,
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
}
