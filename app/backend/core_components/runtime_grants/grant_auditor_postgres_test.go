// grant_auditor_postgres_test.go
// Verifies catalogue discovery and audit output against a disposable PostgreSQL.
// Uses distinct custom role connections, following create_table_registration_test.go.
// Proves label access and read-only refusal with real effective ACLs.
package runtime_grants

import (
	"bytes"
	"context"
	"database/sql"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/lib/pq"
)

func grantDisposableDB(t *testing.T) (*sql.DB, func(string) *sql.DB) {
	t.Helper()
	if os.Getenv("FILTEREST_TEST_DISPOSABLE_POSTGRES") != "1" {
		t.Skip("set FILTEREST_TEST_DISPOSABLE_POSTGRES=1 to run isolated PostgreSQL verification")
	}
	root, err := os.MkdirTemp("", "filterest-runtime-grants-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := os.RemoveAll(root); err != nil {
			t.Error(err)
		}
	})
	socket := filepath.Join(root, "socket")
	if err := os.Mkdir(socket, 0700); err != nil {
		t.Fatal(err)
	}
	data := filepath.Join(root, "db")
	bin := "/usr/lib/postgresql/16/bin/"
	run := func(name string, args ...string) {
		t.Helper()
		if output, err := exec.Command(bin+name, args...).CombinedOutput(); err != nil {
			clusterLog, _ := os.ReadFile(filepath.Join(root, "postgres.log"))
			t.Fatalf("%s failed: %v: %s\n%s", name, err, output, clusterLog)
		}
	}
	run("initdb", "-D", data, "-A", "trust", "-U", "fixture_owner", "--no-locale", "--encoding=UTF8")
	run("pg_ctl", "-D", data, "-l", filepath.Join(root, "postgres.log"), "-o", "-h '' -k '"+socket+"' -p 15462", "-w", "start")
	t.Cleanup(func() {
		output, err := exec.Command(bin+"pg_ctl", "-D", data, "-m", "immediate", "-w", "stop").CombinedOutput()
		if err != nil {
			t.Errorf("stop isolated PostgreSQL: %v: %s", err, output)
		}
	})
	connect := func(role string) *sql.DB {
		t.Helper()
		db, err := sql.Open("postgres", "host="+socket+" port=15462 user='"+role+"' dbname=postgres sslmode=disable")
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { db.Close() })
		if err := db.Ping(); err != nil {
			t.Fatal(err)
		}
		return db
	}
	return connect("fixture_owner"), connect
}

func fixtureExec(t *testing.T, db *sql.DB, query string, args ...any) {
	t.Helper()
	if _, err := db.Exec(query, args...); err != nil {
		t.Fatal(err)
	}
}

func readFixtureSnapshot(t *testing.T, owner *sql.DB, config RoleConfiguration) GrantSnapshot {
	t.Helper()
	tx, err := owner.BeginTx(context.Background(), &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	snapshot, err := LoadGrantSnapshot(context.Background(), tx, config)
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Blockers) > 0 {
		t.Fatal(snapshot.Blockers)
	}
	return snapshot
}

// applyFixtureGrants is test setup, deliberately absent from production code.
func applyFixtureGrants(t *testing.T, owner *sql.DB, s GrantSnapshot, grants GrantSet) {
	t.Helper()
	names := map[string]string{}
	for _, role := range s.Roles {
		names[role.Label] = role.Name
	}
	for _, grant := range grants {
		object := s.Objects[grant.ObjectOID]
		privilege := grant.Privilege
		kind := strings.ToUpper(grant.Kind)
		if kind == "COLUMN" {
			kind = "TABLE"
			privilege += " (" + pq.QuoteIdentifier(grant.Column) + ")"
		}
		fixtureExec(t, owner, "GRANT "+privilege+" ON "+kind+" "+object.Identifier()+" TO "+pq.QuoteIdentifier(names[grant.Role]))
	}
}

func aclFingerprint(t *testing.T, owner *sql.DB) string {
	t.Helper()
	var fingerprint string
	err := owner.QueryRow(`SELECT string_agg(entry,E'\n' ORDER BY entry) FROM (
	 SELECT oid::text||':'||COALESCE(relacl::text,'') AS entry FROM pg_class
	 UNION ALL SELECT attrelid::text||':'||attnum::text||':'||COALESCE(attacl::text,'') FROM pg_attribute
	 UNION ALL SELECT oid::text||':'||defaclacl::text FROM pg_default_acl) entries`).Scan(&fingerprint)
	if err != nil {
		t.Fatal(err)
	}
	return fingerprint
}

func TestSnapshotAndReadOnlyAuditPostgres(t *testing.T) {
	owner, connect := grantDisposableDB(t)
	config := RoleConfiguration{Names: map[string]string{"basic": `wl124 basic "runtime"`, "guest": "wl124 guest runtime", "readonly": "wl124 readonly runtime", "confidential": "wl124 confidential runtime"}, ProtectedNames: []string{"fixture_owner"}}
	for _, name := range config.Names {
		fixtureExec(t, owner, "CREATE ROLE "+pq.QuoteIdentifier(name)+" LOGIN")
	}
	const auditRole = "wl124 independent audit"
	fixtureExec(t, owner, "CREATE ROLE "+pq.QuoteIdentifier(auditRole)+" LOGIN")
	fixtureExec(t, owner, `REVOKE CREATE ON SCHEMA public FROM PUBLIC`)
	fixture, err := os.ReadFile("testdata/grant_catalogue.sql")
	if err != nil {
		t.Fatal(err)
	}
	fixtureExec(t, owner, string(fixture))
	fixtureExec(t, owner, "GRANT USAGE ON SCHEMA public TO "+pq.QuoteIdentifier(auditRole))
	fixtureExec(t, owner, "GRANT SELECT ON ALL TABLES IN SCHEMA public TO "+pq.QuoteIdentifier(auditRole))
	auditor := connect(auditRole)
	basic := connect(config.Names["basic"])
	guest := connect(config.Names["guest"])
	readonly := connect(config.Names["readonly"])
	confidential := connect(config.Names["confidential"])
	snapshot := readFixtureSnapshot(t, owner, config)
	grants := grantsFor(t, snapshot)
	source, target, child, bridge := oidByName(&snapshot, "fresh_source"), oidByName(&snapshot, "fresh_target"), oidByName(&snapshot, "owned_child"), oidByName(&snapshot, "bridge")
	if !containsGrant(grants, "basic", child, "", "INSERT") || !containsGrant(grants, "basic", child, "filename", "UPDATE") || !containsGrant(grants, "basic", bridge, "", "INSERT") {
		t.Fatal("child/bridge/upload requirements not discovered")
	}
	if !containsGrant(grants, "basic", target, "id", "UPDATE") {
		t.Fatal("link lock not discovered")
	}
	if !containsGrant(grants, "guest", target, "title", "SELECT") || containsGrant(grants, "guest", target, "", "SELECT") {
		t.Fatal("fresh guest label target not narrow")
	}
	if containsGrant(grants, "guest", oidByName(&snapshot, "system_users"), "name", "SELECT") {
		t.Fatal("actor marks implied account-name reads")
	}
	for _, name := range []string{"account_view", "nested_account_view"} {
		oid := oidByName(&snapshot, name)
		if !snapshot.Objects[oid].Protected {
			t.Fatal("recursive account-view closure missing")
		}
	}
	sequenceKinds := map[string]bool{}
	for _, use := range snapshot.Sequences {
		object := snapshot.Objects[use.TableOID]
		if object.Name == "fresh_source" || object.Name == "identity_content" || object.Name == "legacy_content" {
			sequenceKinds[object.Name] = true
			if got := containsGrant(grants, "basic", use.SequenceOID, "", "USAGE"); got != use.NextValue {
				t.Fatalf("sequence contract %s got %v want %v", object.Name, got, use.NextValue)
			}
		}
	}
	if len(sequenceKinds) != 3 {
		t.Fatal("serial/identity/legacy dependencies not all discovered")
	}
	for _, use := range snapshot.Sequences {
		if snapshot.Objects[use.TableOID].Name == "system_users" && !snapshot.Objects[use.SequenceOID].Protected {
			t.Fatal("account sequence not protected")
		}
	}
	fixtureExec(t, owner, "GRANT UPDATE ON fresh_target TO "+pq.QuoteIdentifier(config.Names["basic"]))
	fixtureExec(t, owner, "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT UPDATE ON TABLES TO "+pq.QuoteIdentifier(config.Names["basic"]))
	before := aclFingerprint(t, owner)
	findings, err := AuditRuntimeGrants(context.Background(), auditor, config)
	if err != nil {
		t.Fatal(err)
	}
	if HasBlockers(findings) {
		t.Fatal(findings)
	}
	states := map[string]bool{}
	for _, finding := range findings {
		states[finding.Finding] = true
	}
	for _, state := range []string{"missing", "excess_write", "preserved_outside_scope"} {
		if !states[state] {
			t.Fatal("audit finding missing", state)
		}
	}
	var output bytes.Buffer
	if err := WriteFindings(&output, findings); err != nil {
		t.Fatal(err)
	}
	for _, private := range []string{"must not be disclosed", "fixture row value", "fixture-only value", config.Names["basic"], auditRole, "fixture_owner", "password=", "host="} {
		if strings.Contains(output.String(), private) {
			t.Fatal("audit output disclosed private material")
		}
	}
	if after := aclFingerprint(t, owner); after != before {
		t.Fatal("read-only audit changed ACLs")
	}
	if _, err := AuditRuntimeGrants(context.Background(), owner, config); err == nil {
		t.Fatal("owner audit was not refused")
	}
	if _, err := AuditRuntimeGrants(context.Background(), basic, config); err == nil {
		t.Fatal("writable runtime audit was not refused")
	}
	fixtureExec(t, owner, "REVOKE UPDATE ON fresh_target FROM "+pq.QuoteIdentifier(config.Names["basic"]))
	applyFixtureGrants(t, owner, snapshot, grants)
	var label string
	if err := guest.QueryRow(`SELECT b.title FROM fresh_source a LEFT JOIN fresh_target b ON a.target_id=b.id`).Scan(&label); err != nil || label != "visible label" {
		t.Fatalf("fresh label listing: %v", err)
	}
	if err := guest.QueryRow(`SELECT private FROM fresh_target`).Scan(&label); err == nil {
		t.Fatal("label dependency disclosed private column")
	}
	if _, err := guest.Exec(`INSERT INTO fresh_source(title) VALUES('guest')`); err == nil {
		t.Fatal("guest could write")
	}
	if _, err := basic.Exec(`INSERT INTO fresh_source(target_id,title) VALUES(1,'ordinary')`); err != nil {
		t.Fatal("serial insertion failed", err)
	}
	if _, err := basic.Exec(`INSERT INTO identity_content(title) VALUES('identity')`); err != nil {
		t.Fatal("identity insertion required sequence grant", err)
	}
	if _, err := basic.Exec(`INSERT INTO legacy_content(title) VALUES('legacy')`); err != nil {
		t.Fatal("legacy nextval failed", err)
	}
	if _, err := basic.Exec(`UPDATE system_users SET enabled=true`); err == nil {
		t.Fatal("basic could write accounts")
	}
	for _, name := range []string{"system_users", "system_user_groups", "system_user_group_memberships", "system_group_table_func_rights", "system_functions", "account_view", "nested_account_view", "system_row_actor_columns", "system_data_repair_records", "dev_agent_worklines"} {
		for _, pool := range []*sql.DB{basic, guest, readonly, confidential} {
			var write bool
			if err := pool.QueryRow(`SELECT has_table_privilege($1,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_any_column_privilege($1,'INSERT,UPDATE,REFERENCES')`, name).Scan(&write); err != nil {
				t.Fatal(err)
			}
			if write {
				t.Fatal("protected/dedicated object is writable", name)
			}
		}
	}
	fixtureExec(t, owner, `INSERT INTO system_data_repair_records DEFAULT VALUES`)
	var repairRows int
	if err := readonly.QueryRow(`SELECT count(*) FROM system_data_repair_records`).Scan(&repairRows); err != nil || repairRows != 0 {
		t.Fatalf("repair-record RLS contract: %v, rows %d", err, repairRows)
	}
	if _, err := readonly.Exec(`INSERT INTO fresh_source(title) VALUES('readonly')`); err == nil {
		t.Fatal("readonly could write")
	}
	if _, err := confidential.Exec(`INSERT INTO restricted.users_restricted DEFAULT VALUES`); err != nil {
		t.Fatal("restricted confidential contract failed", err)
	}
	if _, err := confidential.Exec(`INSERT INTO fresh_source(title) VALUES('confidential')`); err == nil {
		t.Fatal("confidential could write public content")
	}
	if _, err := basic.Exec(`INSERT INTO fresh_source_lang_embeddings VALUES(1,'embedding')`); err == nil {
		t.Fatal("basic could write embeddings")
	}
	if err := basic.QueryRow(`SELECT id FROM fresh_target WHERE id=1 FOR KEY SHARE`).Scan(new(int)); err != nil {
		t.Fatal("narrow link row lock failed", err)
	}
	t.Run("fresh target labels without target rights", func(t *testing.T) {
		fixtureExec(t, owner, `DELETE FROM system_group_table_func_rights WHERE target_table_uid=2 AND function_id=1`)
		t.Cleanup(func() {
			fixtureExec(t, owner, `INSERT INTO system_group_table_func_rights VALUES(2,1,2)`)
			fixtureExec(t, owner, "GRANT SELECT ON fresh_target TO "+pq.QuoteIdentifier(config.Names["basic"]))
		})
		fixtureExec(t, owner, "REVOKE SELECT ON fresh_target FROM "+pq.QuoteIdentifier(config.Names["basic"]))
		fresh := readFixtureSnapshot(t, owner, config)
		freshGrants := grantsFor(t, fresh)
		if containsGrant(freshGrants, "basic", target, "", "SELECT") {
			t.Fatal("target acquired blanket SELECT")
		}
		applyFixtureGrants(t, owner, fresh, freshGrants)
		if err := basic.QueryRow(`SELECT b.title FROM fresh_source a LEFT JOIN fresh_target b ON a.target_id=b.id WHERE a.id=1`).Scan(&label); err != nil || label != "visible label" {
			t.Fatalf("label with no target right: %v", err)
		}
		if err := basic.QueryRow(`SELECT private FROM fresh_target WHERE id=1`).Scan(&label); err == nil {
			t.Fatal("label access disclosed another target column")
		}
	})
	fixtureExec(t, owner, "GRANT SELECT ON fresh_target TO "+pq.QuoteIdentifier(config.Names["guest"]))
	findings, err = AuditRuntimeGrants(context.Background(), auditor, config)
	if err != nil {
		t.Fatal(err)
	}
	if !hasFinding(findings, "guest", "excess_read_reported", "table", target) {
		t.Fatal("leftover read not reported")
	}
	if !reflect.DeepEqual(snapshot.Roles, readFixtureSnapshot(t, owner, config).Roles) {
		t.Fatal("custom role identities changed")
	}
	// Removing the mutation consumer must drop desired UPDATE(id), regardless
	// of the still-existing SELECT and effective UPDATE ACLs.
	fixtureExec(t, owner, `DELETE FROM system_group_table_func_rights WHERE target_table_uid IN (1,4) AND function_id=2`)
	if containsGrant(grantsFor(t, readFixtureSnapshot(t, owner, config)), "basic", target, "id", "UPDATE") {
		t.Fatal("leftover read retained link UPDATE(id)")
	}
	if source == 0 {
		t.Fatal("source registry missing")
	}
	t.Run("every route with real separate pools", func(t *testing.T) {
		fixtureExec(t, owner, `CREATE TABLE fixture_route_matrix(id serial PRIMARY KEY,title text,search_vector_simple tsvector); INSERT INTO system_db_tables VALUES(18,8,'fixture_route_matrix','public','fixture_route_matrix'::regclass::oid,NULL)`)
		t.Cleanup(func() {
			fixtureExec(t, owner, `DELETE FROM system_group_table_func_rights WHERE target_table_uid=8; DELETE FROM system_functions WHERE id=9; DELETE FROM system_db_tables WHERE table_uid=8; DROP TABLE fixture_route_matrix`)
		})
		for route, operation := range routeOperations {
			fixtureExec(t, owner, `DELETE FROM system_group_table_func_rights WHERE target_table_uid=8; DELETE FROM system_functions WHERE id=9; DELETE FROM fixture_route_matrix`)
			fixtureExec(t, owner, `INSERT INTO system_functions VALUES(9,$1,false,false,true)`, route)
			fixtureExec(t, owner, `INSERT INTO system_group_table_func_rights VALUES(4,9,8),(3,9,8)`)
			for _, name := range []string{config.Names["basic"], config.Names["guest"]} {
				fixtureExec(t, owner, "REVOKE ALL ON TABLE fixture_route_matrix FROM "+pq.QuoteIdentifier(name))
				fixtureExec(t, owner, "REVOKE UPDATE(search_vector_simple) ON TABLE fixture_route_matrix FROM "+pq.QuoteIdentifier(name))
				fixtureExec(t, owner, "REVOKE ALL ON SEQUENCE fixture_route_matrix_id_seq FROM "+pq.QuoteIdentifier(name))
			}
			fresh := readFixtureSnapshot(t, owner, config)
			applyFixtureGrants(t, owner, fresh, grantsFor(t, fresh))
			var rowID int64
			if err := owner.QueryRow(`INSERT INTO fixture_route_matrix(title) VALUES('initial') RETURNING id`).Scan(&rowID); err != nil {
				t.Fatal(err)
			}
			for _, reader := range []struct {
				label string
				pool  *sql.DB
			}{{"basic", basic}, {"guest", guest}} {
				var title string
				err := reader.pool.QueryRow(`SELECT title FROM fixture_route_matrix WHERE id=$1`, rowID).Scan(&title)
				wantRead := reader.label == "basic" || operation == Read
				if (err == nil) != wantRead {
					t.Fatalf("%s %s read: %v", route, reader.label, err)
				}
				for _, write := range []struct {
					operation Operation
					query     string
					args      []any
				}{{Insert, `INSERT INTO fixture_route_matrix(title) VALUES('new') RETURNING title`, nil}, {Update, `UPDATE fixture_route_matrix SET title='changed' WHERE id=$1 RETURNING title`, []any{rowID}}, {Delete, `DELETE FROM fixture_route_matrix WHERE id=$1 RETURNING title`, []any{rowID}}} {
					err := reader.pool.QueryRow(write.query, write.args...).Scan(&title)
					want := reader.label == "basic" && operation == write.operation
					if (err == nil) != want {
						t.Fatalf("%s %s operation %d: %v", route, reader.label, write.operation, err)
					}
				}
			}
		}
	})
	t.Run("unknown table blocks", func(t *testing.T) {
		fixtureExec(t, owner, `CREATE TABLE system_unclassified_fixture(id integer)`)
		t.Cleanup(func() { fixtureExec(t, owner, `DROP TABLE system_unclassified_fixture`) })
		result, err := AuditRuntimeGrants(context.Background(), auditor, config)
		if err != nil {
			t.Fatal(err)
		}
		if !HasBlockers(result) {
			t.Fatal("unknown product table accepted")
		}
	})
	t.Run("inherited role blocks", func(t *testing.T) {
		fixtureExec(t, owner, `CREATE ROLE fixture_inheritance`)
		fixtureExec(t, owner, "GRANT fixture_inheritance TO "+pq.QuoteIdentifier(config.Names["basic"]))
		t.Cleanup(func() {
			fixtureExec(t, owner, "REVOKE fixture_inheritance FROM "+pq.QuoteIdentifier(config.Names["basic"]))
			fixtureExec(t, owner, `DROP ROLE fixture_inheritance`)
		})
		result, err := AuditRuntimeGrants(context.Background(), auditor, config)
		if err != nil {
			t.Fatal(err)
		}
		if !HasBlockers(result) {
			t.Fatal("inherited runtime privileges accepted")
		}
	})
	t.Run("grant option blocks", func(t *testing.T) {
		fixtureExec(t, owner, "GRANT SELECT ON fresh_source TO "+pq.QuoteIdentifier(config.Names["basic"])+" WITH GRANT OPTION")
		t.Cleanup(func() {
			fixtureExec(t, owner, "REVOKE GRANT OPTION FOR SELECT ON fresh_source FROM "+pq.QuoteIdentifier(config.Names["basic"]))
		})
		result, err := AuditRuntimeGrants(context.Background(), auditor, config)
		if err != nil {
			t.Fatal(err)
		}
		if !HasBlockers(result) {
			t.Fatal("runtime grant option accepted")
		}
	})
	t.Run("non-owner grantor requires collateral review", func(t *testing.T) {
		const grantorRole = "wl124 fixture grantor"
		fixtureExec(t, owner, "CREATE ROLE "+pq.QuoteIdentifier(grantorRole)+" LOGIN")
		fixtureExec(t, owner, "GRANT UPDATE ON fresh_target TO "+pq.QuoteIdentifier(grantorRole)+" WITH GRANT OPTION")
		grantor := connect(grantorRole)
		fixtureExec(t, grantor, "GRANT UPDATE ON fresh_target TO "+pq.QuoteIdentifier(config.Names["basic"]))
		t.Cleanup(func() {
			fixtureExec(t, grantor, "REVOKE UPDATE ON fresh_target FROM "+pq.QuoteIdentifier(config.Names["basic"]))
			fixtureExec(t, owner, "REVOKE UPDATE ON fresh_target FROM "+pq.QuoteIdentifier(grantorRole))
			fixtureExec(t, owner, "DROP ROLE "+pq.QuoteIdentifier(grantorRole))
		})
		result, err := AuditRuntimeGrants(context.Background(), auditor, config)
		if err != nil {
			t.Fatal(err)
		}
		if !hasFinding(result, "basic", "blocker", "table", target) {
			t.Fatal("non-owner ACL provenance was ignored")
		}
	})
	t.Run("PUBLIC write refuses audit identity", func(t *testing.T) {
		fixtureExec(t, owner, `GRANT UPDATE ON fresh_target TO PUBLIC`)
		t.Cleanup(func() { fixtureExec(t, owner, `REVOKE UPDATE ON fresh_target FROM PUBLIC`) })
		if _, err := AuditRuntimeGrants(context.Background(), auditor, config); err == nil {
			t.Fatal("PUBLIC made audit identity writable")
		}
	})
	t.Run("unknown trigger SQL blocks", func(t *testing.T) {
		fixtureExec(t, owner, `CREATE FUNCTION fixture_unknown_trigger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.title = 'unknown side effect'; RETURN NEW; END $$; CREATE TRIGGER fixture_unknown BEFORE UPDATE ON fresh_source FOR EACH ROW EXECUTE FUNCTION fixture_unknown_trigger()`)
		t.Cleanup(func() {
			fixtureExec(t, owner, `DROP TRIGGER fixture_unknown ON fresh_source; DROP FUNCTION fixture_unknown_trigger()`)
		})
		result, err := AuditRuntimeGrants(context.Background(), auditor, config)
		if err != nil {
			t.Fatal(err)
		}
		if !HasBlockers(result) {
			t.Fatal("unknown SQL side effects were guessed")
		}
	})
	t.Run("read only transaction rejects mutation", func(t *testing.T) {
		tx, err := auditor.BeginTx(context.Background(), &sql.TxOptions{ReadOnly: true})
		if err != nil {
			t.Fatal(err)
		}
		defer tx.Rollback()
		if _, err := tx.Exec(`CREATE TABLE should_never_exist(id integer)`); err == nil {
			t.Fatal("read-only transaction allowed DDL")
		}
	})
}

func hasFinding(findings []Finding, role, state, kind string, oid int64) bool {
	for _, finding := range findings {
		if finding.Role == role && finding.Finding == state && finding.Kind == kind && finding.ObjectOID == oid {
			return true
		}
	}
	return false
}

func TestAuditSafeOutputWriter(t *testing.T) {
	var output bytes.Buffer
	findings := []Finding{{Role: "basic", Kind: "table", ObjectOID: 10, Privilege: "UPDATE", Finding: "excess_write", Reason: "declared route requirements"}}
	if err := WriteFindings(&output, findings); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(output.String(), `"role":"basic"`) {
		t.Fatal(fmt.Sprint("invalid audit JSON"))
	}
}
