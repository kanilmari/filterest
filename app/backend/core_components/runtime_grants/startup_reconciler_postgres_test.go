// startup_reconciler_postgres_test.go
// Exercises boot/restore grants, legacy findings, defaults and request concurrency.
// Every connection belongs to the opt-in throwaway PostgreSQL cluster.
package runtime_grants

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/lib/pq"
)

func startupGrantFixture(t *testing.T) (*sql.DB, RoleConfiguration, func(string) *sql.DB) {
	t.Helper()
	owner, connect := grantDisposableDB(t)
	config := RoleConfiguration{Names: map[string]string{}, ProtectedNames: []string{"fixture_owner"}}
	for _, label := range []string{"basic", "guest", "readonly", "confidential"} {
		name := `c3 ` + label + ` "runtime"`
		config.Names[label] = name
		fixtureExec(t, owner, "CREATE ROLE "+pq.QuoteIdentifier(name)+" LOGIN")
	}
	data, err := os.ReadFile("testdata/grant_catalogue.sql")
	if err != nil {
		t.Fatal(err)
	}
	fixtureExec(t, owner, string(data))
	// Keep one classified dataset outside the deliberately uncertain fixture
	// closure, so safe revocations can be asserted beside legacy preservation.
	fixtureExec(t, owner, `CREATE TABLE startup_safe_content(id integer PRIMARY KEY);
 INSERT INTO system_db_tables VALUES(90,90,'startup_safe_content','public','startup_safe_content'::regclass::oid,NULL)`)
	return owner, config, connect
}

func startupRun(t *testing.T, owner *sql.DB, config RoleConfiguration) ReconcileResult {
	t.Helper()
	var result ReconcileResult
	err := WithStartupBarrier(context.Background(), owner, func() error {
		var err error
		result, err = EnsureRuntimeRoleGrants(context.Background(), owner, config)
		return err
	})
	if err != nil {
		t.Fatal("start-up refused", err, result.Findings)
	}
	return result
}

func hasFixturePrivilege(t *testing.T, db *sql.DB, role, object, privilege string, want bool) {
	t.Helper()
	var present bool
	if err := db.QueryRow(`SELECT has_table_privilege($1,$2,$3)`, role, object, privilege).Scan(&present); err != nil || present != want {
		t.Fatalf("%s %s=%v, want %v: %v", object, privilege, present, want, err)
	}
}

func TestStartupLegacyBlockersStillProvisionAndAreIdempotentPostgres(t *testing.T) {
	owner, config, _ := startupGrantFixture(t)
	fixtureExec(t, owner, `INSERT INTO system_db_tables VALUES(900,900,'legacy_missing','public',0,NULL);
 INSERT INTO system_triggers(source_table,target_table,action_values) VALUES('absent_automation_source','absent_automation_target','{}');
 CREATE ROLE trusted_legacy_owner NOLOGIN;
 CREATE VIEW systemview_role_table_privileges AS SELECT NULL::text AS role_name,NULL::text AS table_schema,NULL::text AS table_name,NULL::text AS privilege;`)
	for _, fixture := range legacyTriggerFixtures(t) {
		if fixture.name == "systemview_role_table_privileges_upd" {
			fixtureExec(t, owner, fixture.definition)
			fixtureExec(t, owner, `ALTER FUNCTION systemview_role_table_privileges_upd() OWNER TO trusted_legacy_owner;
 CREATE TRIGGER legacy_owner INSTEAD OF INSERT ON systemview_role_table_privileges FOR EACH ROW EXECUTE FUNCTION systemview_role_table_privileges_upd()`)
		}
	}
	// A required positive on a directly blocked dataset must survive too.
	fixtureExec(t, owner, `CREATE FUNCTION uncertain_legacy() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN NEW; END$$;
 CREATE TRIGGER old_uncertain BEFORE INSERT ON fresh_source FOR EACH ROW EXECUTE FUNCTION uncertain_legacy()`)
	fixtureExec(t, owner, "GRANT UPDATE ON fresh_source TO "+pq.QuoteIdentifier(config.Names["basic"]))
	fixtureExec(t, owner, "GRANT UPDATE ON fresh_target TO "+pq.QuoteIdentifier(config.Names["basic"]))
	fixtureExec(t, owner, "GRANT UPDATE ON startup_safe_content TO "+pq.QuoteIdentifier(config.Names["basic"]))
	fixtureExec(t, owner, "GRANT SELECT ON fresh_target TO "+pq.QuoteIdentifier(config.Names["guest"]))
	first := startupRun(t, owner, config)
	if first.Applied == 0 || !HasBlockers(first.Findings) {
		t.Fatal("legacy boot did not provision/report", first)
	}
	hasFixturePrivilege(t, owner, config.Names["basic"], "fresh_source", "INSERT", true)
	hasFixturePrivilege(t, owner, config.Names["basic"], "fresh_source", "UPDATE", true) // uncertainty protects revocations
	hasFixturePrivilege(t, owner, config.Names["basic"], "fresh_target", "UPDATE", true) // downstream uncertainty protects revocations too
	hasFixturePrivilege(t, owner, config.Names["basic"], "startup_safe_content", "UPDATE", false)
	hasFixturePrivilege(t, owner, config.Names["guest"], "fresh_target", "SELECT", true) // stage 2c owns reads
	hasFixturePrivilege(t, owner, config.Names["confidential"], "restricted.users_restricted", "INSERT", true)
	var missing, automations, legacyOwner int
	if err := owner.QueryRow(`SELECT count(*) FROM system_db_tables WHERE table_uid=900`).Scan(&missing); err != nil {
		t.Fatal(err)
	}
	if err := owner.QueryRow(`SELECT count(*) FROM system_triggers WHERE source_table='absent_automation_source'`).Scan(&automations); err != nil {
		t.Fatal(err)
	}
	if err := owner.QueryRow(`SELECT count(*) FROM pg_proc WHERE proname='systemview_role_table_privileges_upd' AND proowner='trusted_legacy_owner'::regrole`).Scan(&legacyOwner); err != nil {
		t.Fatal(err)
	}
	if missing != 1 || automations != 1 || legacyOwner != 1 {
		t.Fatal("startup rewrote unrelated legacy metadata")
	}
	before := aclFingerprint(t, owner)
	second := startupRun(t, owner, config)
	if second.Applied != 0 || before != aclFingerprint(t, owner) {
		t.Fatal("second boot changed ACLs", second.Applied)
	}
}

func TestStartupStructuralFailureRollsBackEntireCataloguePostgres(t *testing.T) {
	owner, config, _ := startupGrantFixture(t)
	fixtureExec(t, owner, "GRANT INSERT ON fresh_target TO "+pq.QuoteIdentifier(config.Names["guest"]))
	fixtureExec(t, owner, "ALTER ROLE "+pq.QuoteIdentifier(config.Names["basic"])+" BYPASSRLS")
	before := aclFingerprint(t, owner)
	_, err := EnsureRuntimeRoleGrants(context.Background(), owner, config)
	if err == nil || !strings.Contains(err.Error(), "basic: runtime identity") || !strings.Contains(err.Error(), fmt.Sprintf("%q", config.Names["basic"])) || before != aclFingerprint(t, owner) {
		t.Fatal("unsafe role changed ACLs or became ready", err)
	}
}

func TestStartupDefaultPrivilegesAllCreatorsAndPublicPostgres(t *testing.T) {
	owner, config, _ := startupGrantFixture(t)
	fixtureExec(t, owner, `CREATE ROLE future_creator NOLOGIN; CREATE SCHEMA extra;`)
	fixtureExec(t, owner, `CREATE ROLE "future ""creator""" NOLOGIN; CREATE SCHEMA "extra ""schema""";`)
	for _, creator := range []string{"fixture_owner", "future_creator", `future "creator"`} {
		for _, schema := range []string{"", "public", "extra", `extra "schema"`} {
			prefix := "ALTER DEFAULT PRIVILEGES FOR ROLE " + pq.QuoteIdentifier(creator)
			if schema != "" {
				prefix += " IN SCHEMA " + pq.QuoteIdentifier(schema)
			}
			for _, label := range []string{"basic", "guest", "confidential", "readonly"} {
				fixtureExec(t, owner, prefix+" GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "+pq.QuoteIdentifier(config.Names[label]))
				fixtureExec(t, owner, prefix+" GRANT USAGE, UPDATE ON SEQUENCES TO "+pq.QuoteIdentifier(config.Names[label]))
			}
			fixtureExec(t, owner, prefix+" GRANT INSERT, UPDATE ON TABLES TO PUBLIC")
		}
	}
	fixtureExec(t, owner, `GRANT INSERT,UPDATE ON startup_safe_content TO PUBLIC; GRANT SELECT ON startup_safe_content TO PUBLIC`)
	startupRun(t, owner, config)
	var invalid int
	if err := owner.QueryRow(`SELECT count(*) FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a
 WHERE (a.grantee=0 OR a.grantee=ANY($1::oid[])) AND (a.privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','USAGE') OR a.privilege_type='SELECT' AND a.grantee=ANY($2::oid[]))
 AND NOT (d.defaclnamespace='restricted'::regnamespace AND a.grantee=$3::regrole)`, pq.Array(roleOIDList(t, owner, config)), pq.Array(roleOIDList(t, owner, RoleConfiguration{Names: map[string]string{"basic": config.Names["basic"], "guest": config.Names["guest"]}})), pq.QuoteIdentifier(config.Names["confidential"])).Scan(&invalid); err != nil || invalid != 0 {
		t.Fatal("unsafe default survived", invalid, err)
	}
	fixtureExec(t, owner, `CREATE TABLE public.future_content(id serial PRIMARY KEY); CREATE TABLE restricted.future_private(id serial PRIMARY KEY)`)
	for _, label := range []string{"basic", "guest", "readonly", "confidential"} {
		hasFixturePrivilege(t, owner, config.Names[label], "future_content", "INSERT", false)
	}
	for _, label := range []string{"basic", "guest"} {
		hasFixturePrivilege(t, owner, config.Names[label], "future_content", "SELECT", false)
	}
	hasFixturePrivilege(t, owner, config.Names["readonly"], "future_content", "SELECT", true)
	hasFixturePrivilege(t, owner, config.Names["confidential"], "restricted.future_private", "INSERT", true)
	hasFixturePrivilege(t, owner, config.Names["guest"], "startup_safe_content", "INSERT", false)
	hasFixturePrivilege(t, owner, config.Names["guest"], "startup_safe_content", "SELECT", true)
}

func roleOIDList(t *testing.T, owner *sql.DB, config RoleConfiguration) []int64 {
	t.Helper()
	var oids []int64
	for _, name := range config.Names {
		var oid int64
		if err := owner.QueryRow(`SELECT oid FROM pg_roles WHERE rolname=$1`, name).Scan(&oid); err != nil {
			t.Fatal(err)
		}
		oids = append(oids, oid)
	}
	return oids
}

func TestColdRestoreReconciliationBeforeReadinessPostgres(t *testing.T) {
	owner, config, _ := startupGrantFixture(t)
	fixtureExec(t, owner, "GRANT INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO "+pq.QuoteIdentifier(config.Names["guest"]))
	// pg_dump and psql inherit only this throwaway cluster's connection values.
	var socket, user string
	var port int
	if err := owner.QueryRow(`SELECT current_setting('unix_socket_directories'),current_setting('port')::int,current_user`).Scan(&socket, &port, &user); err != nil {
		t.Fatal(err)
	}
	dump, err := exec.Command("/usr/lib/postgresql/16/bin/pg_dump", "-h", socket, "-p", fmt.Sprint(port), "-U", user, "-d", "postgres").Output()
	if err != nil {
		t.Fatal(err)
	}
	fixtureExec(t, owner, `CREATE DATABASE restored_c3`)
	restored, err := sql.Open("postgres", "host="+socket+" port="+fmt.Sprint(port)+" user="+user+" dbname=restored_c3 sslmode=disable")
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Close()
	ready := false
	err = WithStartupBarrier(context.Background(), restored, func() error {
		importer := exec.Command("/usr/lib/postgresql/16/bin/psql", "-v", "ON_ERROR_STOP=1", "-h", socket, "-p", fmt.Sprint(port), "-U", user, "-d", "restored_c3")
		importer.Stdin = strings.NewReader(string(dump))
		if output, err := importer.CombinedOutput(); err != nil {
			return fmt.Errorf("cold import: %w: %s", err, output)
		}
		// Cold restore discovery refreshes dump-local OIDs before policy evaluation.
		if _, err := restored.Exec(`UPDATE system_db_tables SET cached_oid=to_regclass(format('%I.%I',schema_name,table_name))::oid`); err != nil {
			return err
		}
		if _, err := EnsureRuntimeRoleGrants(context.Background(), restored, config); err != nil {
			return err
		}
		ready = true
		return nil
	})
	if err != nil || !ready {
		t.Fatal("restored database was not ready after policy", err)
	}
	hasFixturePrivilege(t, restored, config.Names["guest"], "startup_safe_content", "INSERT", false)
	hasFixturePrivilege(t, restored, config.Names["basic"], "fresh_source", "INSERT", true)
}

func TestStartupBarrierDrainsRequestAndKeepsPolicyLockOrderPostgres(t *testing.T) {
	owner, config, _ := startupGrantFixture(t)
	tx, err := owner.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if err = LockRuntimeGrantPolicy(context.Background(), tx); err != nil {
		t.Fatal(err)
	}
	started := make(chan struct{})
	done := make(chan error, 1)
	go func() {
		close(started)
		done <- WithStartupBarrier(context.Background(), owner, func() error { _, err := EnsureRuntimeRoleGrants(context.Background(), owner, config); return err })
	}()
	<-started
	select {
	case err := <-done:
		t.Fatal("startup ignored active request", err)
	case <-time.After(100 * time.Millisecond):
	}
	if err = tx.Commit(); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-done:
		if err != nil {
			t.Fatal("startup/request lock order failed", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("startup did not drain")
	}
	// Request snapshot must observe boot's completed grants after waiting.
	err = WithStartupBarrier(context.Background(), owner, func() error {
		request, err := owner.Begin()
		if err != nil {
			return err
		}
		defer request.Rollback()
		ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
		defer cancel()
		err = LockRuntimeGrantPolicy(ctx, request)
		if err == nil {
			return fmt.Errorf("request entered the exclusive startup barrier")
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

func TestPooledHTTPRequestDrainsWithoutReacquiringBehindStartupPostgres(t *testing.T) {
	owner, config, _ := startupGrantFixture(t)
	done := make(chan error, 1)
	err := WithRequestBarrier(context.Background(), owner, func(ctx context.Context) error {
		go func() {
			done <- WithStartupBarrier(context.Background(), owner, func() error { _, err := EnsureRuntimeRoleGrants(context.Background(), owner, config); return err })
		}()
		// Wait until boot is queued for the exclusive session lock. The HTTP
		// request's policy tx must not queue a second shared lock behind that waiter.
		deadline := time.Now().Add(2 * time.Second)
		for {
			var waiting bool
			if err := owner.QueryRow(`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted)`).Scan(&waiting); err != nil {
				return err
			}
			if waiting {
				break
			}
			if time.Now().After(deadline) {
				return fmt.Errorf("boot never reached its drain barrier")
			}
			time.Sleep(10 * time.Millisecond)
		}
		request, err := owner.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		defer request.Rollback()
		bounded, cancel := context.WithTimeout(ctx, time.Second)
		defer cancel()
		if err := LockRuntimeGrantPolicy(bounded, request); err != nil {
			return fmt.Errorf("HTTP request reacquired lifecycle lock behind boot: %w", err)
		}
		return request.Commit()
	})
	if err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("boot did not finish after pooled request drained")
	}
}
