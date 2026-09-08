// database_consistency_media_registry_test.go
// Verifies direct consistency-repair requests cannot register or drop internal media tables.
// Connects the existing repair handler with its SQL queue test double.
// Preserves ordinary dataset repairs while keeping independent media behind its API.
package system_table_tools

import (
	"database/sql/driver"
	"strings"
	"testing"
)

func TestMediaRegistryConsistencyRepairRejectsDirectRegisterAndDrop(t *testing.T) {
	for _, table := range []string{"system_media_assets", "system_media_asset_usages"} {
		for _, action := range []string{"register", "drop", ""} {
			t.Run(table+"/"+action, func(t *testing.T) {
				resetOrphanQueues()
				defer resetOrphanQueues()
				db := newSystemTableToolsTestDB(t)
				defer db.Close()
				pushOrphanQuery(orphanQueuedQuery{cols: []string{"nspname"}, rows: [][]driver.Value{{"public"}}})
				id := "cat2_" + table
				err := fixIssue(db, id, map[string]string{id: action})
				if err == nil || !strings.Contains(err.Error(), "dedicated API") {
					t.Fatalf("repair unexpectedly allowed: %v", err)
				}
				calls := snapshotOrphanCalls()
				if len(calls) != 1 || !strings.Contains(calls[0], "SELECT n.nspname") {
					t.Fatalf("repair wrote or registered metadata: %v", calls)
				}
			})
		}
	}
}

func TestMediaRegistryRepairGuardDoesNotChangeOtherSchemasOrDatasetNames(t *testing.T) {
	for _, tc := range []struct{ schema, table string }{{"tenant", "system_media_assets"}, {"public", "system_media_assets_archive"}} {
		t.Run(tc.schema+"/"+tc.table, func(t *testing.T) {
			resetOrphanQueues()
			defer resetOrphanQueues()
			db := newSystemTableToolsTestDB(t)
			defer db.Close()
			pushOrphanQuery(orphanQueuedQuery{cols: []string{"nspname"}, rows: [][]driver.Value{{tc.schema}}})
			pushOrphanExec(orphanQueuedExec{rowsAffected: 1})
			id := "cat2_" + tc.table
			if err := fixIssue(db, id, map[string]string{id: "drop"}); err != nil {
				t.Fatal(err)
			}
			calls := snapshotOrphanCalls()
			if len(calls) != 2 || !strings.Contains(calls[1], "DROP TABLE IF EXISTS") {
				t.Fatal("ordinary repair behavior changed")
			}
		})
	}
}
