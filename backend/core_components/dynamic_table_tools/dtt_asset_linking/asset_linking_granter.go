// asset_linking_granter.go
// Grants inherited table permissions from a parent table to its asset child table.
// Bridges existing table-level rights and newly created asset child tables.
// Exists to keep permission inheritance logic centralized for the asset-linking module.
package dtt_asset_linking

import (
	"log"

	"easelect/backend/core_components/dbutils"
)

// CopyTablePermissions mirrors parent table rights onto the child asset table.
func CopyTablePermissions(q dbutils.Querier, parentUID, childUID int) {
	_, err := q.Exec(
		`INSERT INTO system_group_table_func_rights (user_group_id, function_id, target_table_uid, target_schema_name)
		 SELECT user_group_id, function_id, $1, target_schema_name
		 FROM system_group_table_func_rights
		 WHERE target_table_uid = $2
		 ON CONFLICT DO NOTHING`,
		childUID, parentUID,
	)
	if err != nil {
		log.Printf("[asset_linking] warning: failed to copy permissions from parent (uid=%d) to child (uid=%d): %v",
			parentUID, childUID, err)
	}
}
