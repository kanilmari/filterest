// bridge_updates.go
// Bridge functions that connect the column and table update workflow to their
// implementation packages. Wires security.SanitizeIdentifier and the
// create/delete/update sub-packages into a single call surface.

package dtt_crud_workflows

import (
	"database/sql"

	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/dynamic_table_tools/dtt_2_column_crud"
	"easelect/backend/core_components/dynamic_table_tools/dtt_2_column_crud/dtt_2_column_update"
	"easelect/backend/core_components/dynamic_table_tools/dtt_3_table_crud/dtt_3_table_create"
	"easelect/backend/core_components/dynamic_table_tools/dtt_3_table_crud/dtt_3_table_delete"
	"easelect/backend/core_components/dynamic_table_tools/dtt_3_table_crud/dtt_3_table_update"
	"easelect/backend/core_components/security"
)

// UpdateColumnsWithBridge kutsuu dtt_2_column_update -paketin UpdateColumns-funktiota
func UpdateColumnsWithBridge(
	tx *sql.Tx,
	sanitizedTableName string,
	modifiedCols []dtt_2_column_crud.ModifiedCol,
) error {
	return dtt_2_column_update.UpdateColumns(
		tx,
		sanitizedTableName,
		modifiedCols,
		security.SanitizeIdentifier,
	)
}

// UpdateOidsAndTableNamesWithBridge kutsuu dtt_3_table_update.UpdateOidsAndTableNames(...)
// ja välittää callbackit poistettujen taulujen, uusien taulujen sekä
// olemassaolevien sarakkeiden päivityksen hoitamiseksi.
// Accepts a Querier (either *sql.DB or *sql.Tx) for transaction safety.
func UpdateOidsAndTableNamesWithBridge(q dbutils.Querier) error {
	return dtt_3_table_update.UpdateOidsAndTableNames(
		q,
		dtt_3_table_delete.DeleteRemovedTables, // Poistetut taulut
		dtt_3_table_create.InsertNewTables,     // Uudet taulut
	)
}
