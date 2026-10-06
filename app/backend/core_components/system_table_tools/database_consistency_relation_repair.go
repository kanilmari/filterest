// database_consistency_relation_repair.go
// Rechecks category-5 orphan conditions when a requested repair deletes a relation.
// Connects issue IDs with the same registry-existence predicates as the issue listing.
// Protects valid or concurrently repaired rows from stale repair requests.
package system_table_tools

import (
	"easelect/backend/core_components/dbutils"
	"errors"
)

var errConsistencyFixSkipped = errors.New("relation is absent or no longer dangling")

func repairOrphanForeignKeyRelation(q dbutils.Querier, manyToMany bool, rowID string) error {
	query := `DELETE FROM system_foreign_key_relations_1_m fk WHERE id = $1::bigint AND (
		NOT EXISTS (SELECT 1 FROM system_db_tables WHERE table_uid = fk.source_table_uid)
		OR NOT EXISTS (SELECT 1 FROM system_db_tables WHERE table_uid = fk.target_table_uid))`
	if manyToMany {
		query = `DELETE FROM system_foreign_key_relations_m_m fk WHERE id = $1::bigint AND (
			NOT EXISTS (SELECT 1 FROM system_db_tables WHERE table_uid = fk.table_a_uid)
			OR NOT EXISTS (SELECT 1 FROM system_db_tables WHERE table_uid = fk.table_b_uid)
			OR NOT EXISTS (SELECT 1 FROM system_db_tables WHERE table_uid = fk.bridging_table_uid))`
	}
	result, err := q.Exec(query, rowID)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count == 0 {
		return errConsistencyFixSkipped
	}
	return nil
}
