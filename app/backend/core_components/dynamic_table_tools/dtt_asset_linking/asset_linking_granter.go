// asset_linking_granter.go
// Seeds independent child application rights once when a relation is linked.
// Connects parent rights to child registration; database ACLs come from the policy.
// Returns failures so rights, configuration and reconciliation roll back together.
package dtt_asset_linking

import (
	"easelect/backend/core_components/dbutils"
	"fmt"
)

// CopyTablePermissions seeds the child rights; later configuration edits never call it.
func CopyTablePermissions(q dbutils.Querier, parentUID, childUID int) error {
	_, err := q.Exec(`INSERT INTO system_group_table_func_rights (user_group_id, function_id, target_table_uid, target_schema_name)
 SELECT user_group_id, function_id, $1, target_schema_name
 FROM system_group_table_func_rights WHERE target_table_uid = $2
 ON CONFLICT DO NOTHING`, childUID, parentUID)
	if err != nil {
		return fmt.Errorf("seed asset child rights: %w", err)
	}
	return nil
}
