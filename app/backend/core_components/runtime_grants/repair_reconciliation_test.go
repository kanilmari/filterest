// repair_reconciliation_test.go
// Verifies that removing dangling metadata releases its former write quarantine.
// Reuses the catalogue applier driver to distinguish repairs from ordinary saves.
// PostgreSQL hook tests remain the proof of the real repaired catalogue and ACL.
package runtime_grants

import (
	"context"
	"database/sql"
	"errors"
	"testing"
)

func TestRepairedMetadataAllowsExcessWriteRevocation(t *testing.T) {
	for _, repair := range []bool{false, true} {
		t.Run(map[bool]string{false: "ordinary save retains old blocker", true: "repair uses corrected metadata"}[repair], func(t *testing.T) {
			after := policyFixture()
			after.Objects = map[int64]Object{10: after.Objects[10]}
			after.Rights = []Right{{2, 1, 1}} // Read remains; DELETE is excess.
			config := RoleConfiguration{Names: map[string]string{}}
			for i, key := range []string{"DB_BASIC_USER", "DB_GUEST_USER", "DB_READONLY_USER", "DB_CONFIDENTIAL_USER"} {
				after.Roles[i].Name, after.Roles[i].OID = key, int64(i+1)
				config.Names[after.Roles[i].Label] = key
			}
			before := after
			before.Blockers = []Finding{{Role: "policy", Kind: "table", Object: `"public"."system_foreign_key_relations_1_m"`,
				ScopeOIDs: [3]int64{10}, Finding: "blocker", Reason: "row id 37: missing snapshot identity target_table_uid=999999999"}}
			scope := ChangedDatasetOIDs(before, after)
			deleteKey := grantKey(Grant{Role: "basic", Kind: "table", ObjectOID: 10, Privilege: "DELETE"})
			state := &applierDriver{snapshot: after, present: map[string]bool{deleteKey: true}}
			db := sql.OpenDB(state)
			defer db.Close()
			tx, err := db.Begin()
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback()
			previous := &before
			if repair {
				previous = nil // FinishRepair retains endpoints, not the obsolete blocker.
			}
			_, err = ReconcileRuntimeGrantsScoped(context.Background(), tx, config, previous, scope)
			var blocked *ScopeBlocker
			if !repair {
				if !errors.As(err, &blocked) || !state.present[deleteKey] || len(state.statements) != 0 {
					t.Fatal("ordinary save modified a blocked dataset", err, state.statements)
				}
			} else if err != nil || state.present[deleteKey] {
				t.Fatal("corrected metadata retained the excess write", err, state.statements)
			}
		})
	}
}
