// create_table_grant_scope_postgres_test.go
// Proves creation tolerates unrelated audit blockers and refuses its own dependencies.
// Uses the shipped bootstrap and the existing opt-in disposable PostgreSQL helper.
// Keeps the original ordered-column and read-matrix assertions unchanged.
package dtt_crud_workflows

import (
	"context"
	"net/http"
	"os"
	"strings"
	"testing"

	"easelect/backend/core_components/runtime_grants"
	"github.com/lib/pq"
)

func TestCreationGrantBlockersStayWithinRequestedDatasetsPostgres(t *testing.T) {
	db, _ := registrationDisposableDB(t)
	loadPublicBootstrap(t, db)
	mustExec := func(query string, args ...interface{}) {
		t.Helper()
		if _, err := db.Exec(query, args...); err != nil {
			t.Fatal(err)
		}
	}
	mustExec(`CREATE TABLE existing_dataset(id integer PRIMARY KEY,title text);
		CREATE TABLE system_wl124_unknown(id integer PRIMARY KEY,title text)`)
	mustExec("GRANT UPDATE ON existing_dataset,system_wl124_unknown TO " + pq.QuoteIdentifier(os.Getenv("DB_BASIC_USER")))
	acl := func() string {
		t.Helper()
		var value string
		if err := db.QueryRow(`SELECT string_agg(relname || ':' || COALESCE(relacl::text,''),',' ORDER BY relname)
			FROM pg_class WHERE oid IN ('existing_dataset'::regclass,'system_wl124_unknown'::regclass)`).Scan(&value); err != nil {
			t.Fatal(err)
		}
		return value
	}
	beforeACL := acl()
	// Bootstrap rows 209 and 216 intentionally describe absent tables here.
	// A new dataset's registry write must not adopt either row as its scope.
	var dangling int
	if err := db.QueryRow(`SELECT count(*) FROM system_db_tables WHERE table_name IN ('spatial_ref_sys','payments')
		AND to_regclass(format('%I.%I',schema_name,table_name)) IS NULL`).Scan(&dangling); err != nil || dangling != 2 {
		t.Fatalf("bootstrap dangling rows=%d: %v", dangling, err)
	}
	// Hold the original snapshot so the proof includes an unregistered content
	// table even if creation's shared metadata refresh subsequently registers it.
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	roles := runtime_grants.ConfiguredRoles(os.Getenv)
	before, err := runtime_grants.LoadMutationSnapshot(context.Background(), tx, roles)
	_ = tx.Rollback()
	if err != nil {
		t.Fatal(err)
	}
	rec := postCreateDataset(t, db, `{"dataset_name":"wl124_scope_target","folder_id":4,
		"column_list":[{"name":"id","data_type":"SERIAL"},{"name":"title","data_type":"TEXT"}]}`)
	if rec.Code != http.StatusCreated || acl() != beforeACL {
		t.Fatalf("unrelated blockers refused creation or changed their ACLs: %d %s", rec.Code, rec.Body)
	}
	tx, err = db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	var oid int64
	if err := tx.QueryRow(`SELECT 'wl124_scope_target'::regclass::oid`).Scan(&oid); err != nil {
		t.Fatal(err)
	}
	result, err := runtime_grants.ReconcileRuntimeGrantsScoped(context.Background(), tx, roles, &before, []int64{oid})
	if err != nil || result.Applied != 0 {
		t.Fatalf("scoped second pass: %v %+v", err, result)
	}
	for _, name := range []string{"spatial_ref_sys", "payments", "existing_dataset", "system_wl124_unknown"} {
		found := false
		for _, finding := range result.Findings {
			found = found || finding.Finding == "blocker" && (strings.Contains(finding.Object, name) || strings.Contains(finding.Reason, name))
		}
		if !found {
			t.Fatalf("outside blocker %s disappeared from diagnostics", name)
		}
	}
	_ = tx.Rollback()

	// A dangling relation on an existing dataset is relevant to a new dataset
	// that references it, even though the storage registry is shared globally.
	// Today's registry foreign key refuses such a row, but an older database can still hold one, so the
	// fixture skips the key check for this one insert (same connection, one statement batch).
	mustExec(`SET session_replication_role = replica;
		INSERT INTO system_foreign_key_relations_1_m(source_table_uid,target_table_uid,source_column_name,target_column_name)
		SELECT table_uid,999999999,'id','id' FROM system_db_tables WHERE table_name='wl124_scope_target';
		SET session_replication_role = origin`)
	for _, test := range []struct{ name, target string }{
		{"wl124_unknown_ref", "system_wl124_unknown"},
		{"wl124_dangling_ref", "wl124_scope_target"},
	} {
		t.Run(test.name, func(t *testing.T) {
			var registryBefore, rightsBefore, registryAfter, rightsAfter int
			if err := db.QueryRow(`SELECT (SELECT count(*) FROM system_db_tables),(SELECT count(*) FROM system_group_table_func_rights)`).Scan(&registryBefore, &rightsBefore); err != nil {
				t.Fatal(err)
			}
			rec := postCreateDataset(t, db, `{"dataset_name":"`+test.name+`","folder_id":4,"grant_users_read":true,
				"column_list":[{"name":"id","data_type":"SERIAL"},{"name":"target_id","data_type":"INTEGER"}],
				"foreign_keys":[{"referencing_column":"target_id","referenced_dataset":"`+test.target+`","referenced_column":"id"}]}`)
			if rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), "error_runtime_grant_policy_blocked") {
				t.Fatalf("dependency blocker accepted: %d %s", rec.Code, rec.Body)
			}
			var exists bool
			if err := db.QueryRow(`SELECT to_regclass($1) IS NOT NULL`, test.name).Scan(&exists); err != nil {
				t.Fatal(err)
			}
			if err := db.QueryRow(`SELECT (SELECT count(*) FROM system_db_tables),(SELECT count(*) FROM system_group_table_func_rights)`).Scan(&registryAfter, &rightsAfter); err != nil {
				t.Fatal(err)
			}
			if exists || registryAfter != registryBefore || rightsAfter != rightsBefore || acl() != beforeACL {
				t.Fatal("refused creation left schema, rights, registry rows or ACL changes")
			}
		})
	}
}
