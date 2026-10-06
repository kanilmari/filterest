// rights_mutations_postgres_test.go
// Proves real rights HTTP mutations and CSV imports with separate PostgreSQL roles.
// Starts only the existing opt-in disposable cluster and never contacts a site.
// Covers last removal, additive reads, scoped refusal, rollback and idempotence.
package runtime_grants_test

import (
	"context"
	"database/sql"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	devtools "easelect/backend/core_components/dev_tools"
	"easelect/backend/core_components/middlewares"
	. "easelect/backend/core_components/runtime_grants"
	"easelect/backend/core_components/runtimepaths"
	esessions "easelect/backend/core_components/sessions"
	"github.com/gorilla/sessions"
	"github.com/lib/pq"
)

func TestRightsMutationAndImportPostgres(t *testing.T) {
	owner, connect := GrantDisposableDB(t)
	config := RoleConfiguration{Names: map[string]string{"basic": `c2 basic "quoted"`, "guest": "c2 guest", "readonly": "c2 readonly", "confidential": "c2 confidential"}, ProtectedNames: []string{"fixture_owner"}}
	for label, key := range map[string]string{"basic": "DB_BASIC_USER", "guest": "DB_GUEST_USER", "readonly": "DB_READONLY_USER", "confidential": "DB_CONFIDENTIAL_USER"} {
		t.Setenv(key, config.Names[label])
		FixtureExec(t, owner, "CREATE ROLE "+pq.QuoteIdentifier(config.Names[label])+" LOGIN")
	}
	fixture, err := os.ReadFile("testdata/grant_catalogue.sql")
	if err != nil {
		t.Fatal(err)
	}
	FixtureExec(t, owner, string(fixture))
	FixtureExec(t, owner, `ALTER TABLE system_group_table_func_rights ADD COLUMN target_schema_name text DEFAULT 'public';
 DELETE FROM system_group_table_func_rights; DELETE FROM system_triggers;
 DELETE FROM system_foreign_key_relations_1_m; DELETE FROM system_foreign_key_relations_m_m;
 CREATE TABLE system_config(key text,bool_value boolean);
 CREATE TABLE outside_unknown(id integer);
 CREATE FUNCTION public.app_row_actor_column(target regclass, actor_role text) RETURNS text LANGUAGE SQL STABLE AS $$
 SELECT m.column_name FROM public.system_row_actor_columns m JOIN public.system_db_tables d ON d.table_uid=m.table_uid
 WHERE to_regclass(format('%I.%I',d.schema_name,d.table_name))=$1 AND m.actor_role=$2 $$;
 INSERT INTO system_db_tables VALUES(800,80,'system_group_table_func_rights','public','system_group_table_func_rights'::regclass::oid,NULL)`)
	FixtureExec(t, owner, "GRANT UPDATE ON outside_unknown TO "+pq.QuoteIdentifier(config.Names["basic"]))
	FixtureExec(t, owner, "GRANT SELECT ON fresh_source TO "+pq.QuoteIdentifier(config.Names["readonly"]))
	basic, guest, readonly := connect(config.Names["basic"]), connect(config.Names["guest"]), connect(config.Names["readonly"])
	oldDB, oldAdmin, oldBasic, oldGuest, oldReadonly := backend.Db, backend.DbAdmin, backend.DbBasic, backend.DbGuest, backend.DbReaderOnly
	backend.Db, backend.DbAdmin, backend.DbBasic, backend.DbGuest, backend.DbReaderOnly = owner, owner, basic, guest, readonly
	oldStore := esessions.Store
	esessions.Store = sessions.NewCookieStore([]byte("disposable-rights-mutation-test"))
	t.Cleanup(func() {
		backend.Db, backend.DbAdmin, backend.DbBasic, backend.DbGuest, backend.DbReaderOnly = oldDB, oldAdmin, oldBasic, oldGuest, oldReadonly
		esessions.Store = oldStore
	})
	request := func(handler http.HandlerFunc, method, url, body string, want int) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, url, strings.NewReader(body))
		req = req.WithContext(dbutils.SetRequestActorContext(req.Context(), dbutils.NewRequestActorContext(2, "admin")))
		rec := httptest.NewRecorder()
		middlewares.WithLazyTransaction(handler).ServeHTTP(rec, req)
		if rec.Code != want {
			t.Fatalf("%s %s: status=%d body=%s", method, url, rec.Code, rec.Body)
		}
		return rec
	}
	assertWrite := func(pool *sql.DB, privilege string, want bool) {
		t.Helper()
		var present bool
		if err := pool.QueryRow(`SELECT has_table_privilege('fresh_source',$1)`, privilege).Scan(&present); err != nil || present != want {
			t.Fatalf("%s=%v want %v: %v", privilege, present, want, err)
		}
	}
	post := `{"permissions":[{"user_group_id":2,"function_id":2,"target_schema_name":"public","target_table_uid":1}]}`
	request(backend.PermissionsHandler, "POST", "/api/permissions", post, 201)
	assertWrite(basic, "INSERT", true)
	assertWrite(guest, "INSERT", false)
	// Removing registry-wide scope must not let a request save a right for
	// its own absent dataset merely because that dataset has no physical OID.
	aclBeforeDangling := ACLFingerprint(t, owner)
	request(backend.PermissionsHandler, "PATCH", "/api/permissions", `{"add":[{"user_group_id":2,"function_id":1,"target_table_uid":999999}]}`, 409)
	var danglingRight bool
	if err := owner.QueryRow(`SELECT EXISTS(SELECT 1 FROM system_group_table_func_rights WHERE target_table_uid=999999)`).Scan(&danglingRight); err != nil || danglingRight || ACLFingerprint(t, owner) != aclBeforeDangling {
		t.Fatal("dangling request target left rights or ACL changes", err)
	}
	var inserted int64
	if err := basic.QueryRow(`INSERT INTO fresh_source(title) VALUES('real basic write') RETURNING id`).Scan(&inserted); err != nil {
		t.Fatal(err)
	}
	if _, err := guest.Exec(`INSERT INTO fresh_source(title) VALUES('forbidden')`); err == nil {
		t.Fatal("guest wrote content")
	}
	request(backend.PermissionsHandler, "POST", "/api/permissions?dataset_uid=1", `{"permissions":[]}`, 201)
	assertWrite(basic, "INSERT", false)
	var title string
	if err := readonly.QueryRow(`SELECT title FROM fresh_source LIMIT 1`).Scan(&title); err != nil {
		t.Fatal("readonly contract changed", err)
	}
	add := `{"add":[{"user_group_id":2,"function_id":3,"target_schema_name":"public","target_table_uid":1}]}`
	request(backend.PermissionsHandler, "PATCH", "/api/permissions", add, 200)
	assertWrite(basic, "UPDATE", true)
	request(backend.PermissionsHandler, "PATCH", "/api/permissions", strings.Replace(add, `"add"`, `"remove"`, 1), 200)
	assertWrite(basic, "UPDATE", false)
	// Rights union retains another group's declared mutation after one removal.
	request(backend.PermissionsHandler, "POST", "/api/permissions", `{"permissions":[{"user_group_id":2,"function_id":2,"target_table_uid":1},{"user_group_id":4,"function_id":2,"target_table_uid":1},{"user_group_id":3,"function_id":1,"target_table_uid":1}]}`, 201)
	request(backend.PermissionsHandler, "PATCH", "/api/permissions", `{"remove":[{"user_group_id":2,"function_id":2,"target_schema_name":"public","target_table_uid":1}]}`, 200)
	assertWrite(basic, "INSERT", true)
	assertWrite(guest, "SELECT", true)
	assertWrite(guest, "INSERT", false)
	var unknownWrite bool
	if err := basic.QueryRow(`SELECT has_table_privilege('outside_unknown','UPDATE')`).Scan(&unknownWrite); err != nil || !unknownWrite {
		t.Fatal("outside blocker ACL changed", err)
	}
	// Put an unreviewed trigger on this request's dataset; no rights/ACL survives.
	FixtureExec(t, owner, `CREATE FUNCTION unreviewed_source_trigger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
 CREATE TRIGGER unreviewed BEFORE INSERT ON fresh_source FOR EACH ROW EXECUTE FUNCTION unreviewed_source_trigger()`)
	before := ACLFingerprint(t, owner)
	rec := request(backend.PermissionsHandler, "POST", "/api/permissions?dataset_uid=1", `{"permissions":[]}`, 409)
	if !strings.Contains(rec.Body.String(), "error_runtime_grant_policy_blocked") || ACLFingerprint(t, owner) != before {
		t.Fatal("scoped refusal changed grants", rec.Body)
	}
	assertWrite(basic, "INSERT", true)
	FixtureExec(t, owner, `DROP TRIGGER unreviewed ON fresh_source; DROP FUNCTION unreviewed_source_trigger()`)
	// An inherited PUBLIC write cannot be removed by REVOKE from basic. Its
	// postcheck must fail and roll back both the new right and other ACL deltas.
	FixtureExec(t, owner, `GRANT DELETE ON fresh_source TO PUBLIC`)
	before = ACLFingerprint(t, owner)
	request(backend.PermissionsHandler, "PATCH", "/api/permissions", add, 500)
	if ACLFingerprint(t, owner) != before {
		t.Fatal("failed reconcile changed grants")
	}
	assertWrite(basic, "UPDATE", false)
	FixtureExec(t, owner, `REVOKE DELETE ON fresh_source FROM PUBLIC`)
	paths, err := runtimepaths.Resolve(t.TempDir(), t.TempDir(), false)
	if err != nil {
		t.Fatal(err)
	}
	ConfigureReviewRuntimePaths(t, paths)
	// The CSV importer reads the same directory: the installation root in the flat legacy layout.
	dir := filepath.Join(paths.RuntimeRoot, "tables_data")
	if paths.LegacyFlat {
		dir = filepath.Join(paths.InstallationRoot, "tables_data")
	}
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "system_group_table_func_rights.csv"), []byte("id,user_group_id,function_id,target_table_uid,target_schema_name\n999,2,3,1,public\n"), 0600); err != nil {
		t.Fatal(err)
	}
	request(devtools.ImportTableCSVHandler, "POST", "/api/import-table-csv?dataset=system_group_table_func_rights", "", 200)
	assertWrite(basic, "UPDATE", true)
	tx, err := owner.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	result, err := ReconcileRuntimeGrantsScoped(context.Background(), tx, config, nil, []int64{})
	if err != nil || result.Applied != 0 {
		t.Fatal("idempotent second pass changed ACL", result, err)
	}
	request(backend.PermissionsHandler, "DELETE", "/api/permissions", "", 405)
}
