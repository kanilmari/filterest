// blocker_locality_postgres_test.go
// Proves administrator saves with no dataset targets beside an old invalid automation.
// Uses real generic update handlers, grant reconciliation and committed bootstrap rows.
// Two missing action columns must stay a deterministic, unrelated diagnostic.
package runtime_grants_test

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"strings"
	"testing"

	update "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_update"
	. "easelect/backend/core_components/runtime_grants"
)

func TestUnrelatedAdministratorSavesBesideOldAutomationBlockerPostgres(t *testing.T) {
	f := newMutationHooksFixture(t)
	f.create("old_blocker_source", "")
	f.create("old_blocker_target", "")
	FixtureExec(t, f.owner, `
 INSERT INTO system_functions(name,package,url_route_endpoint,disabled,ui_only,specific_table_related)
 VALUES('unused_before','fixture','/ui/unused-locality-proof',false,true,false);
 UPDATE system_column_details c SET editable_in_ui=true FROM system_db_tables d
 WHERE c.table_uid=d.table_uid AND
   ((d.table_name='system_functions' AND c.column_name='name') OR
    (d.table_name='system_user_group_memberships' AND c.column_name='group_id'));
 INSERT INTO system_triggers(source_table,target_table,condition,action_values)
 VALUES('old_blocker_source','old_blocker_target','true','{"missing_z":1,"missing_a":2}');`)
	var functionID, membershipID int64
	if err := f.owner.QueryRow(`SELECT id FROM system_functions WHERE name='unused_before'`).Scan(&functionID); err != nil {
		t.Fatal(err)
	}
	if err := f.owner.QueryRow(`SELECT id FROM system_user_group_memberships WHERE user_id=2 AND group_id=2`).Scan(&membershipID); err != nil {
		t.Fatal(err)
	}
	readSnapshot := func() GrantSnapshot {
		t.Helper()
		tx, err := f.owner.BeginTx(context.Background(), &sql.TxOptions{ReadOnly: true})
		if err != nil {
			t.Fatal(err)
		}
		defer tx.Rollback()
		snapshot, err := LoadMutationSnapshot(context.Background(), tx, f.roles)
		if err != nil {
			t.Fatal(err)
		}
		return snapshot
	}
	before := readSnapshot()
	var oldBlocker *Finding
	for i := range before.Blockers {
		if strings.Contains(before.Blockers[i].Reason, "missing automation destination column") {
			oldBlocker = &before.Blockers[i]
		}
	}
	if oldBlocker == nil || !strings.HasSuffix(oldBlocker.Reason, "column missing_a") || oldBlocker.ScopeOIDs[0] == 0 || oldBlocker.ScopeOIDs[1] == 0 {
		t.Fatal("fixture lacks a resolved, deterministic two-missing-column blocker", before.Blockers)
	}
	// Force the former wording drift through PostgreSQL too. There are no
	// dataset targets, and no actual endpoint changed between these snapshots.
	oldBlocker.Reason = strings.TrimSuffix(oldBlocker.Reason, "missing_a") + "missing_z"
	tx, err := f.owner.Begin()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ReconcileHTTPRuntimeGrantsScoped(context.Background(), tx, f.roles, &before, []int64{}); err != nil {
		tx.Rollback()
		t.Fatal("reason-only drift refused an empty generic request scope", err)
	}
	if err := tx.Rollback(); err != nil {
		t.Fatal(err)
	}
	before = readSnapshot()
	f.request(func(w http.ResponseWriter, r *http.Request) {
		update.UpdateRowHandler(w, r, "system_functions")
	}, fmt.Sprintf(`{"id":%d,"column":"name","value":"unused_after"}`, functionID), http.StatusOK)
	f.request(func(w http.ResponseWriter, r *http.Request) {
		update.UpdateRowHandler(w, r, "system_user_group_memberships")
	}, fmt.Sprintf(`{"id":%d,"column":"group_id","value":3}`, membershipID), http.StatusOK)
	var name, actions string
	var groupID int
	if err := f.owner.QueryRow(`SELECT name FROM system_functions WHERE id=$1`, functionID).Scan(&name); err != nil || name != "unused_after" {
		t.Fatal("unused function save did not commit", name, err)
	}
	if err := f.owner.QueryRow(`SELECT group_id FROM system_user_group_memberships WHERE id=$1 AND user_id=2`, membershipID).Scan(&groupID); err != nil || groupID != 3 {
		t.Fatal("other account membership save did not commit", groupID, err)
	}
	if err := f.owner.QueryRow(`SELECT action_values FROM system_triggers WHERE source_table='old_blocker_source'`).Scan(&actions); err != nil || actions != `{"missing_z":1,"missing_a":2}` {
		t.Fatal("unrelated automation changed", actions, err)
	}
	after := readSnapshot()
	if targets := ChangedDatasetOIDs(before, after); len(targets) != 0 || !HasBlockers(after.Blockers) {
		t.Fatal("unrelated saves adopted datasets or lost the old diagnostic", targets, after.Blockers)
	}
}
