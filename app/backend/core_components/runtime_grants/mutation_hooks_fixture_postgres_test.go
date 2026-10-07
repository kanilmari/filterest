// mutation_hooks_fixture_postgres_test.go
// Shares the shipped bootstrap and real middleware across grant-changing routes.
// Starts only the existing opt-in throwaway PostgreSQL fixture.
// Quotes custom runtime identities and retains independent caller connections.
package runtime_grants_test

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	workflows "easelect/backend/core_components/dynamic_table_tools/dtt_crud_workflows"
	"easelect/backend/core_components/middlewares"
	. "easelect/backend/core_components/runtime_grants"
	"easelect/backend/core_components/runtimepaths"
	esessions "easelect/backend/core_components/sessions"
	"github.com/gorilla/sessions"
	"github.com/lib/pq"
)

type mutationHooksFixture struct {
	t                   *testing.T
	owner, basic, guest *sql.DB
	roles               RoleConfiguration
}

func newMutationHooksFixture(t *testing.T) *mutationHooksFixture {
	t.Helper()
	owner, connect := GrantDisposableDB(t)
	roles := RoleConfiguration{Names: map[string]string{}, ProtectedNames: []string{"fixture_owner"}}
	for label, key := range map[string]string{"basic": "DB_BASIC_USER", "guest": "DB_GUEST_USER", "readonly": "DB_READONLY_USER", "confidential": "DB_CONFIDENTIAL_USER"} {
		name := "c2b " + label + ` "custom"`
		roles.Names[label] = name
		t.Setenv(key, name)
		FixtureExec(t, owner, "CREATE ROLE "+pq.QuoteIdentifier(name)+" LOGIN")
	}
	for _, name := range []string{"schema.sql", "seed_data.sql"} {
		bytes, err := os.ReadFile(filepath.Join("..", "..", "..", "server_tools", "public_bootstrap", name))
		if err != nil {
			t.Fatal(err)
		}
		FixtureExec(t, owner, string(bytes))
	}
	// These routes run as a trusted administrator. The public example user is
	// ordinary in the shipped seed; this fixture explicitly grants BOTH admin gates.
	FixtureExec(t, owner, `UPDATE system_users SET admin_access_allowed=true WHERE id=2;
        INSERT INTO system_user_group_memberships(user_id,group_id) VALUES(2,1)`)
	// A bootstrap import precedes startup's route registration. These HTTP
	// proofs need the add route too; otherwise right() inserts zero rows.
	FixtureExec(t, owner, `INSERT INTO system_functions
 (name,package,url_route_endpoint,disabled,ui_only,specific_table_related)
 VALUES('dtt_1_row_create.AddRowMultipartHandler','dtt_1_row_create','/api/add-row-multipart',false,false,true);
 CREATE TABLE system_triggers(id serial PRIMARY KEY,source_table text,condition text,target_table text,action_values text)`)
	basic, guest, readonly := connect(roles.Names["basic"]), connect(roles.Names["guest"]), connect(roles.Names["readonly"])
	oldDB, oldAdmin, oldBasic, oldGuest, oldReadonly := backend.Db, backend.DbAdmin, backend.DbBasic, backend.DbGuest, backend.DbReaderOnly
	backend.Db, backend.DbAdmin, backend.DbBasic, backend.DbGuest, backend.DbReaderOnly = owner, owner, basic, guest, readonly
	oldStore := esessions.Store
	esessions.Store = sessions.NewCookieStore([]byte("c2b-hook-tests"))
	t.Cleanup(func() {
		backend.Db, backend.DbAdmin, backend.DbBasic, backend.DbGuest, backend.DbReaderOnly = oldDB, oldAdmin, oldBasic, oldGuest, oldReadonly
		esessions.Store = oldStore
	})
	paths, err := runtimepaths.Resolve(t.TempDir(), t.TempDir(), true)
	if err != nil {
		t.Fatal(err)
	}
	ConfigureReviewRuntimePaths(t, paths)
	return &mutationHooksFixture{t, owner, basic, guest, roles}
}
func (f *mutationHooksFixture) request(handler http.HandlerFunc, body string, want int) *httptest.ResponseRecorder {
	f.t.Helper()
	req := httptest.NewRequest("POST", "/api/test-grant-hook", strings.NewReader(body))
	req = req.WithContext(dbutils.SetRequestActorContext(req.Context(), dbutils.NewRequestActorContext(2, "admin")))
	session, err := esessions.Load(req)
	if err != nil {
		f.t.Fatal(err)
	}
	session.Values["user_id"] = 2
	session.Values["user_role"] = "admin"
	rec := httptest.NewRecorder()
	middlewares.WithLazyTransaction(handler).ServeHTTP(rec, req)
	if rec.Code != want {
		f.t.Fatalf("hook status=%d want %d: %s", rec.Code, want, rec.Body)
	}
	return rec
}
func (f *mutationHooksFixture) create(name string, extra string) int64 {
	f.t.Helper()
	f.request(workflows.CreateTableHandler, `{"dataset_name":"`+name+`","folder_id":4,"grant_users_read":true,
 "column_list":[{"name":"id","data_type":"SERIAL"},{"name":"title","data_type":"TEXT"}`+extra+`]}`, http.StatusCreated)
	var uid int64
	if err := f.owner.QueryRow(`SELECT table_uid FROM system_db_tables WHERE table_name=$1`, name).Scan(&uid); err != nil {
		f.t.Fatal(err)
	}
	return uid
}
func (f *mutationHooksFixture) right(name, route string) {
	f.t.Helper()
	result, err := f.owner.Exec(`INSERT INTO system_group_table_func_rights(user_group_id,function_id,target_table_uid,target_schema_name)
 SELECT g.id,fn.id,d.table_uid,'public' FROM system_user_groups g,system_functions fn,system_db_tables d
 WHERE g.name='users' AND fn.url_route_endpoint=$1 AND d.table_name=$2 AND (fn.disabled=false OR fn.disabled IS NULL)`, route, name)
	if err != nil {
		f.t.Fatal(err)
	}
	if count, err := result.RowsAffected(); err != nil || count != 1 {
		f.t.Fatalf("seed %s right on %s: inserted %d rows, want 1: %v", route, name, count, err)
	}
}
func (f *mutationHooksFixture) privilege(table, column, privilege string, want bool) {
	f.t.Helper()
	var present bool
	query := `SELECT has_table_privilege($1,$2)`
	args := []any{table, privilege}
	if column != "" {
		query = `SELECT has_column_privilege($1,$2,$3)`
		args = []any{table, column, privilege}
	}
	if err := f.basic.QueryRow(query, args...).Scan(&present); err != nil || present != want {
		f.logPolicy(table, column, privilege)
		f.t.Fatalf("%s %s(%s)=%v want %v: %v", table, privilege, column, present, want, err)
	}
	var guestWrite bool
	if err := f.guest.QueryRow(`SELECT has_table_privilege($1,'INSERT,UPDATE,DELETE') OR has_any_column_privilege($1,'INSERT,UPDATE')`, table).Scan(&guestWrite); err != nil || guestWrite {
		f.t.Fatal("guest writes", table, err)
	}
}

// A PostgreSQL failure must distinguish absent fixture rights, preserved
// blocker ACLs and an applier defect without requiring another blind rerun.
func (f *mutationHooksFixture) logPolicy(table, column, privilege string) {
	f.t.Helper()
	var currentUser, acl string
	if err := f.basic.QueryRow(`SELECT current_user`).Scan(&currentUser); err == nil {
		f.t.Logf("privilege reader=%q configured basic=%q", currentUser, f.roles.Names["basic"])
	}
	if err := f.owner.QueryRow(`SELECT COALESCE(relacl::text,'default') FROM pg_class WHERE oid=to_regclass($1)`, table).Scan(&acl); err == nil {
		f.t.Logf("current dataset ACL: %s", acl)
	}
	tx, err := f.owner.BeginTx(context.Background(), &sql.TxOptions{ReadOnly: true})
	if err != nil {
		f.t.Log("read failing policy snapshot:", err)
		return
	}
	defer tx.Rollback()
	snapshot, err := LoadMutationSnapshot(context.Background(), tx, f.roles)
	if err != nil {
		f.t.Log("load failing policy snapshot:", err)
		return
	}
	f.t.Logf("current policy blockers: %+v", snapshot.Blockers)
	for oid, object := range snapshot.Objects {
		if object.Schema != "public" || object.Name != table {
			continue
		}
		f.t.Logf("current dataset: OID=%d UID=%d protected=%t", oid, object.DatasetUID, object.Protected)
		for _, dependency := range snapshot.Dependencies {
			if dependency.SourceOID == oid || dependency.TargetOID == oid || dependency.RelatedOID == oid {
				f.t.Logf("current dependency: %+v", dependency)
			}
		}
		for _, right := range snapshot.Rights {
			if right.DatasetUID == object.DatasetUID {
				f.t.Logf("current right: %+v function=%+v", right, snapshot.Functions[right.FunctionID])
			}
		}
		grants, err := DesiredDatasetRuntimeGrants(snapshot, object.DatasetUID)
		f.t.Logf("current desired dataset policy error: %v", err)
		for _, grant := range grants {
			if grant.Role == "basic" && grant.ObjectOID == oid && grant.Privilege == privilege && (grant.Column == "" || grant.Column == column) {
				f.t.Logf("current desired grant: %+v", grant)
			}
		}
	}
}
func (f *mutationHooksFixture) excess(table string) {
	f.t.Helper()
	FixtureExec(f.t, f.owner, "GRANT DELETE ON "+pq.QuoteIdentifier(table)+" TO "+pq.QuoteIdentifier(f.roles.Names["basic"]))
}
func (f *mutationHooksFixture) assertUID(name string, uid int64) {
	f.t.Helper()
	var got int64
	if err := f.owner.QueryRow(`SELECT table_uid FROM system_db_tables WHERE table_name=$1`, name).Scan(&got); err != nil || got != uid {
		f.t.Fatal("stable dataset identity changed", name, got, uid, err)
	}
}
func (f *mutationHooksFixture) treeID(name string) int64 {
	f.t.Helper()
	var id int64
	if err := f.owner.QueryRow(`SELECT id FROM system_db_tables WHERE table_name=$1`, name).Scan(&id); err != nil {
		f.t.Fatal(err)
	}
	return id
}

// Repair fixtures filter their inserted dangling target; asset fixtures keep
// their ordinary source lookup. Ordering makes either selection deterministic.
func (f *mutationHooksFixture) relationID(child string, targetUID ...int64) int64 {
	f.t.Helper()
	var id int64
	var target any
	if len(targetUID) > 0 {
		target = targetUID[0]
	}
	if err := f.owner.QueryRow(`SELECT r.id FROM system_foreign_key_relations_1_m r
 JOIN system_db_tables d ON d.table_uid=r.source_table_uid
 WHERE d.table_name=$1 AND ($2::bigint IS NULL OR r.target_table_uid=$2)
 ORDER BY r.id DESC LIMIT 1`, child, target).Scan(&id); err != nil {
		f.t.Fatal(err)
	}
	return id
}
func (f *mutationHooksFixture) rowExists(table string, id int64) bool {
	f.t.Helper()
	var exists bool
	if err := f.owner.QueryRow(fmt.Sprintf(`SELECT EXISTS(SELECT 1 FROM %s WHERE id=$1)`, pq.QuoteIdentifier(table)), id).Scan(&exists); err != nil {
		f.t.Fatal(err)
	}
	return exists
}
