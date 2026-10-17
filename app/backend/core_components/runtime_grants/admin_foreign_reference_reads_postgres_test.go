// admin_foreign_reference_reads_postgres_test.go
// Pins SEC-L's dependency on startup granting admins explicit FK-target Read.
// Connects the fresh bootstrap, real startup reconcilers and row-editor updates.
// Catalogue-wide coverage catches new FK targets missing startup Read grants;
// account authority and source UPDATE alone must still yield an FK-specific 403.
package runtime_grants_test

import (
	"fmt"
	"net/http"
	"strings"
	"testing"

	backend "easelect/backend/core_components"
	update "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_update"
	. "easelect/backend/core_components/runtime_grants"
)

func TestStartupAdminGrantsCoverForeignKeyReadsPostgres(t *testing.T) {
	f := newMutationHooksFixture(t)
	t.Setenv("FILTEREST_ADMIN_PERMISSION_RECOVERY_MODE", "0")
	// The fresh-bootstrap fixture has no UPDATE route until registration. Add
	// its identity, then let the same two reconcilers as startup supply grants.
	FixtureExec(t, f.owner, `INSERT INTO system_functions
	 (name,package,url_route_endpoint,disabled,specific_table_related)
	 VALUES('dtt_1_row_update.UpdateRowHandlerWrapper','dtt_1_row_update','/api/update-row',false,true);
	 INSERT INTO system_users(id,username,enabled) VALUES(42,'Membership fixture one',true),(43,'Membership fixture two',true);
	 INSERT INTO system_user_group_memberships(user_id,group_id) VALUES(42,2);`)
	if err := backend.EnsureAdminPermissions(f.owner); err != nil {
		t.Fatal(err)
	}
	if err := backend.EnsureAdminTablePermissions(f.owner); err != nil {
		t.Fatal(err)
	}

	// Inspect every physical FK of every registered source, including protected
	// columns and read-only sources. Do not restrict coverage to today's editor
	// inventory. An unregistered target also fails: it cannot have an explicit grant.
	rows, err := f.owner.Query(`WITH targets AS (
	 SELECT DISTINCT parent_ns.nspname AS schema_name, parent.relname AS table_name
	 FROM pg_constraint fk
	 JOIN pg_class child ON child.oid=fk.conrelid
	 JOIN pg_namespace child_ns ON child_ns.oid=child.relnamespace
	 JOIN system_db_tables source ON source.table_name=child.relname
	  AND COALESCE(NULLIF(source.schema_name,''),'public')=child_ns.nspname
	 JOIN pg_class parent ON parent.oid=fk.confrelid
	 JOIN pg_namespace parent_ns ON parent_ns.oid=parent.relnamespace
	 WHERE fk.contype='f'
	)
	SELECT targets.schema_name, targets.table_name, EXISTS (
	 SELECT 1 FROM system_db_tables target
	 JOIN system_group_table_func_rights r ON r.target_table_uid=target.table_uid
	 JOIN system_functions fn ON fn.id=r.function_id
	 WHERE target.table_name=targets.table_name
	  AND COALESCE(NULLIF(target.schema_name,''),'public')=targets.schema_name
	  AND r.user_group_id=1
	  AND COALESCE(NULLIF(r.target_schema_name,''),'public')=targets.schema_name
	  AND fn.url_route_endpoint='/api/get-results' AND fn.disabled IS FALSE
	) FROM targets ORDER BY targets.schema_name, targets.table_name`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var targetCount int
	for rows.Next() {
		var schema, table string
		var readable bool
		if err := rows.Scan(&schema, &table, &readable); err != nil {
			t.Fatal(err)
		}
		targetCount++
		if !readable {
			t.Errorf("startup left FK target %s.%s without explicit enabled admin /api/get-results Read", schema, table)
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if targetCount == 0 {
		t.Fatal("fresh bootstrap must contain registered sources with foreign keys")
	}
	t.Logf("checked startup admin Read on %d catalogue-derived FK targets", targetCount)
	var membershipID int64
	if err := f.owner.QueryRow(`SELECT id FROM system_user_group_memberships WHERE user_id=42 AND group_id=2`).Scan(&membershipID); err != nil {
		t.Fatal(err)
	}
	request := func(column string, value, status int) string {
		t.Helper()
		body := fmt.Sprintf(`{"id":%d,"column":%q,"value":%d}`, membershipID, column, value)
		return f.request(func(w http.ResponseWriter, r *http.Request) {
			r.URL.RawQuery = "dataset=system_user_group_memberships"
			update.UpdateRowHandlerWrapper(w, r)
		}, body, status).Body.String()
	}
	assertStored := func(user, group int) {
		t.Helper()
		var gotUser, gotGroup int
		if err := f.owner.QueryRow(`SELECT user_id,group_id FROM system_user_group_memberships WHERE id=$1`, membershipID).Scan(&gotUser, &gotGroup); err != nil || gotUser != user || gotGroup != group {
			t.Fatalf("stored membership=(%d,%d), want (%d,%d): %v", gotUser, gotGroup, user, group, err)
		}
	}
	// The fresh seed lacks these target Reads; startup reconciliation supplies them.
	request("group_id", 3, http.StatusOK)
	assertStored(42, 3)
	request("user_id", 43, http.StatusOK)
	assertStored(43, 3)

	// Keep this actor an administrator with source UPDATE authority, but remove
	// target Read. A tableless Read must not satisfy either strict FK check.
	FixtureExec(t, f.owner, `DELETE FROM system_group_table_func_rights r USING system_functions f,system_db_tables d
	 WHERE r.function_id=f.id AND r.target_table_uid=d.table_uid
	 AND r.user_group_id IN (SELECT group_id FROM system_user_group_memberships WHERE user_id=2)
	 AND f.url_route_endpoint='/api/get-results' AND d.table_name IN ('system_users','system_user_groups');
	 INSERT INTO system_group_table_func_rights(user_group_id,function_id,target_table_uid)
	 SELECT 1,id,NULL FROM system_functions WHERE url_route_endpoint='/api/get-results'
	 ON CONFLICT DO NOTHING;`)
	var sourceUpdate bool
	if err := f.owner.QueryRow(`SELECT EXISTS (
	 SELECT 1 FROM system_group_table_func_rights r
	 JOIN system_functions fn ON fn.id=r.function_id
	 JOIN system_db_tables d ON d.table_uid=r.target_table_uid
	 WHERE r.user_group_id=1 AND fn.url_route_endpoint='/api/update-row'
	  AND fn.disabled IS FALSE AND d.table_name='system_user_group_memberships'
	)`).Scan(&sourceUpdate); err != nil || !sourceUpdate {
		t.Fatalf("non-reader must retain startup's source UPDATE grant: %v", err)
	}
	for _, edit := range []struct {
		column string
		value  int
	}{{"group_id", 2}, {"user_id", 42}} {
		body := request(edit.column, edit.value, http.StatusForbidden)
		if !strings.Contains(body, "foreign row cannot be read") {
			t.Fatalf("non-reader refusal must come from FK Read, not the account guard: %s", body)
		}
		assertStored(43, 3)
	}
}
