// kind_evidence_sync_test.go
// Proves relation discovery clears cached kind evidence after each committed write.
// Connects actual one-to-many/many-to-many sync to a warm catalogue probe.
// Covers failed writes and partial completion without database access.
package dtt_foreign_keys

import (
	"database/sql/driver"
	"errors"
	"testing"

	"easelect/backend/core_components/dataset_kinds/kindtest"
)

func TestKindEvidenceRelationSyncCommittedWrites(t *testing.T) {
	for _, many := range []bool{false, true} {
		for _, end := range []string{"success", "first write fails", "second write fails"} {
			label := "one-to-many/"
			if many {
				label = "many-to-many/"
			}
			t.Run(label+end, func(t *testing.T) {
				read := kindtest.WarmProbe(t)
				read(1)
				query, metadata, deletion := "FROM pg_constraint c", "FROM system_foreign_key_relations_1_m fr", "DELETE FROM system_foreign_key_relations_1_m"
				cols := []string{"id", "source_table_name", "source_column_name", "target_table_name", "target_column_name"}
				values := [][]driver.Value{{int64(1), "posts", "user_id", "users", "id"}, {int64(2), "posts", "other_id", "users", "id"}}
				syncRelations := SyncOneToManyFKConstraints
				if many {
					query, metadata, deletion = "WITH all_fk_info AS", "FROM system_foreign_key_relations_m_m fr", "DELETE FROM system_foreign_key_relations_m_m"
					cols = []string{"id", "bridge", "a", "b", "table_a", "col_a", "table_b", "col_b"}
					values = [][]driver.Value{{int64(1), "old_join", "a", "b", "users", "id", "teams", "id"}, {int64(2), "other_join", "a", "b", "users", "id", "teams", "id"}}
					syncRelations = SyncManyToManyFKConstraints
				}
				execs := []foreignKeyExecResponse{{match: deletion, rowsAffected: 1}, {match: deletion, rowsAffected: 1}}
				if end == "first write fails" {
					execs[0].err = errors.New("write refused")
				}
				if end == "second write fails" {
					execs[1].err = errors.New("write refused")
				}
				db, _ := openForeignKeyMockDB(t, []foreignKeyQueryResponse{{match: query, cols: []string{"catalogue"}}, {match: metadata, cols: cols, rows: values}}, execs)
				err := syncRelations(db)
				if (err != nil) != (end != "success") {
					t.Fatal(err)
				}
				want := int64(2)
				if end == "first write fails" {
					want = 1
				}
				read(want)
			})
		}
	}
}
