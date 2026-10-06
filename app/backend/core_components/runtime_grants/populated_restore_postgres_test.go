// populated_restore_postgres_test.go
// Runs the actual backup writer and replacement restore against populated PostgreSQL.
// Docker is only a local command adapter; pg_dump/psql and reconciliation are real.
// Readiness waits for the new policy, while the old database remains recoverable.
package runtime_grants

import (
	"context"
	"database/sql"

	"fmt"
	"github.com/lib/pq"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestGeneratedBackupRestoresPopulatedTargetAndReconcilesPostgres(t *testing.T) {
	owner, config, _ := startupGrantFixture(t)
	fixtureExec(t, owner, `CREATE TABLE system_db_version(version text); INSERT INTO system_db_version VALUES('fixture')`)
	// A multi-statement query runs as one implicit transaction, which CREATE DATABASE refuses.
	fixtureExec(t, owner, `CREATE DATABASE populated_target TEMPLATE template0 ENCODING 'LATIN1' LC_COLLATE 'C' LC_CTYPE 'C'`)
	var socket string
	var port int
	if err := owner.QueryRow(`SELECT current_setting('unix_socket_directories'),current_setting('port')::int`).Scan(&socket, &port); err != nil {
		t.Fatal(err)
	}
	connect := func(name string) *sql.DB {
		t.Helper()
		db, err := sql.Open("postgres", fmt.Sprintf("host=%s port=%d user=fixture_owner dbname=%s sslmode=disable", socket, port, name))
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { db.Close() })
		return db
	}
	target := connect("populated_target")
	fixtureExec(t, target, `CREATE TABLE old_only(id int);INSERT INTO old_only VALUES(42);CREATE TABLE system_db_version(version text);INSERT INTO system_db_version VALUES('old')`)
	fixtureExec(t, owner, `CREATE ROLE restore_function_owner NOLOGIN; CREATE ROLE restore_database_owner NOLOGIN`)
	for _, db := range []*sql.DB{owner, target} {
		fixtureExec(t, db, `CREATE FUNCTION public.restore_restricted_secret() RETURNS int LANGUAGE sql SECURITY DEFINER AS $$SELECT 42$$;
   REVOKE EXECUTE ON FUNCTION public.restore_restricted_secret() FROM PUBLIC;
   ALTER FUNCTION public.restore_restricted_secret() OWNER TO restore_function_owner;
   CREATE AGGREGATE public.restore_restricted_sum(integer) (SFUNC=int4pl,STYPE=integer,INITCOND='0');
   REVOKE EXECUTE ON FUNCTION public.restore_restricted_sum(integer) FROM PUBLIC;
   ALTER AGGREGATE public.restore_restricted_sum(integer) OWNER TO restore_function_owner;
   CREATE SCHEMA postgis;`)
	}
	var postgisAvailable bool
	if err := owner.QueryRow(`SELECT EXISTS(SELECT 1 FROM pg_available_extensions WHERE name='postgis')`).Scan(&postgisAvailable); err != nil {
		t.Fatal(err)
	}
	for _, db := range []*sql.DB{owner, target} {
		if postgisAvailable {
			fixtureExec(t, db, `CREATE EXTENSION postgis WITH SCHEMA postgis`)
		} else {
			fixtureExec(t, db, `CREATE FUNCTION postgis.restore_search_path_probe() RETURNS int LANGUAGE sql AS $$SELECT 42$$`)
		}
	}
	fixtureExec(t, owner, `ALTER DATABASE populated_target OWNER TO restore_database_owner`)
	fixtureExec(t, owner, `ALTER DATABASE populated_target SET search_path=public,postgis`)
	fixtureExec(t, owner, `ALTER DATABASE populated_target CONNECTION LIMIT 7`)
	fixtureExec(t, owner, `REVOKE CONNECT ON DATABASE populated_target FROM PUBLIC`)
	fixtureExec(t, owner, "GRANT CONNECT ON DATABASE populated_target TO "+pq.QuoteIdentifier(config.Names["basic"])+","+pq.QuoteIdentifier(config.Names["guest"]))
	fixtureExec(t, owner, "ALTER ROLE "+pq.QuoteIdentifier(config.Names["basic"])+" IN DATABASE populated_target SET statement_timeout='7s'")
	beforeSettings := restoreDatabaseFingerprint(t, owner, "populated_target")
	target.Close()
	root := t.TempDir()
	instanceDir := filepath.Join(root, "instances", "proof")
	if err := os.MkdirAll(instanceDir, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(instanceDir, ".env"), []byte("DB_ADMIN_USER=fixture_owner\nDB_NAME=populated_target\nAPP_PORT=1\n"), 0600); err != nil {
		t.Fatal(err)
	}
	source, err := filepath.Abs("../../../server_tools/ctl/lib/instance_backup.sh")
	if err != nil {
		t.Fatal(err)
	}
	script := populatedRestoreScript
	cmd := exec.Command("bash", "-c", script)
	cmd.Dir = root
	cmd.Env = append(os.Environ(), "BACKUP_SOURCE="+source, "EASELECT_RESTORE_CONFIRM=yes", "PGHOST="+socket, fmt.Sprintf("PGPORT=%d", port), "PGUSER=fixture_owner")
	output := &strings.Builder{}
	cmd.Stdout = output
	cmd.Stderr = output
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	waited := false
	defer func() {
		if !waited {
			_ = cmd.Process.Kill()
			<-done
		}
	}()
	deadline := time.Now().Add(20 * time.Second)
	for {
		if _, err := os.Stat(filepath.Join(root, "waiting-for-readiness")); err == nil {
			break
		}
		select {
		case err := <-done:
			waited = true
			t.Fatalf("restore failed before reconciliation: %v %s", err, output.String())
		default:
		}
		if time.Now().After(deadline) {
			t.Fatal("restore never reached readiness")
		}
		time.Sleep(10 * time.Millisecond)
	}
	restored := connect("populated_target")
	if got := restoreDatabaseFingerprint(t, owner, "populated_target"); got != beforeSettings {
		t.Fatalf("database configuration changed after restore:\nbefore %s\nafter %s", beforeSettings, got)
	}
	var functionOwner string
	if err := restored.QueryRow(`SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid='public.restore_restricted_secret()'::regprocedure`).Scan(&functionOwner); err != nil || functionOwner != "restore_function_owner" {
		t.Fatal("definer owner changed", functionOwner, err)
	}
	for _, label := range []string{"basic", "guest"} {
		connector, err := pq.NewConnector(fmt.Sprintf("host=%s port=%d user='%s' dbname=populated_target sslmode=disable", socket, port, config.Names[label]))
		if err != nil {
			t.Fatal(err)
		}
		limited := sql.OpenDB(connector)
		_, err = limited.ExecContext(context.Background(), `SELECT public.restore_restricted_secret()`)
		if label == "basic" {
			var timeout string
			if err := limited.QueryRow(`SHOW statement_timeout`).Scan(&timeout); err != nil || timeout != "7s" {
				t.Fatal("per-role setting was lost", timeout, err)
			}
		}
		limited.Close()
		if pgerr, ok := err.(*pq.Error); !ok || pgerr.Code != "42501" {
			t.Fatal("restore exposed restricted definer execution", label, err)
		}
	}
	var path string
	if err := restored.QueryRow(`SHOW search_path`).Scan(&path); err != nil || path != "public, postgis" {
		t.Fatal("database search_path was lost", path, err)
	}
	if postgisAvailable {
		var geometry string
		if err := restored.QueryRow(`SELECT ST_AsText(ST_GeomFromText('POINT(24 60)',4326))`).Scan(&geometry); err != nil || geometry != "POINT(24 60)" {
			t.Fatal("unqualified PostGIS call failed", geometry, err)
		}
	} else {
		var value int
		if err := restored.QueryRow(`SELECT restore_search_path_probe()`).Scan(&value); err != nil || value != 42 {
			t.Fatal("unqualified non-public function failed", value, err)
		}
	}
	// Run the actual startup policy while the shell is waiting for its marker.
	fixtureExec(t, restored, `UPDATE system_db_tables SET cached_oid=to_regclass(format('%I.%I',schema_name,table_name))::oid`)
	startupRun(t, restored, config)
	for _, label := range []string{"basic", "guest"} {
		for _, identity := range []string{"public.restore_restricted_secret()", "public.restore_restricted_sum(integer)"} {
			var allowed bool
			if err := restored.QueryRow(`SELECT has_function_privilege($1,$2,'EXECUTE')`, config.Names[label], identity).Scan(&allowed); err != nil || allowed {
				t.Fatal("reconciled restore widened routine execution", label, identity, err)
			}
		}
	}
	hasFixturePrivilege(t, restored, config.Names["guest"], "startup_safe_content", "INSERT", false)
	hasFixturePrivilege(t, restored, config.Names["basic"], "fresh_source", "INSERT", true)
	if err := os.WriteFile(filepath.Join(root, "reconciled"), []byte("runtime_grants=reconciled"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := <-done; err != nil {
		waited = true
		t.Fatal(err, output.String())
	}
	waited = true
	if !strings.Contains(output.String(), "restored and reconciled") {
		t.Fatal(output.String())
	}
	files, err := filepath.Glob(filepath.Join(instanceDir, "backups", "restore_*.txt"))
	if err != nil || len(files) != 1 {
		t.Fatal("recovery evidence missing", files, err)
	}
	evidence, err := os.ReadFile(files[0])
	if err != nil {
		t.Fatal(err)
	}
	var recovery string
	for _, line := range strings.Split(string(evidence), "\n") {
		if strings.HasPrefix(line, "recovery=") {
			recovery = strings.TrimPrefix(line, "recovery=")
		}
	}
	var retained int
	// ALLOW_CONNECTIONS remains false on the old DB; inspect its existence
	// through the maintenance connection without reopening it for consumers.
	if err := owner.QueryRow(`SELECT count(*) FROM pg_database WHERE datname=$1 AND NOT datallowconn`, recovery).Scan(&retained); err != nil || retained != 1 {
		t.Fatal("populated original was not retained", recovery, err)
	}
	var newCount int
	if err := restored.QueryRow(`SELECT count(*) FROM fresh_source`).Scan(&newCount); err != nil || newCount != 1 {
		t.Fatal("backup data not restored", newCount, err)
	}
	if !strings.Contains(string(evidence), "phase=ready") {
		t.Fatal("readiness evidence absent", string(evidence))
	}
}

// Uses role OIDs within this one cluster and normalizes ACL/config array order.
func restoreDatabaseFingerprint(t *testing.T, db *sql.DB, name string) string {
	t.Helper()
	var value string
	err := db.QueryRow(`SELECT jsonb_build_object('owner',datdba,'limit',datconnlimit,'encoding',encoding,
  'collation',datcollate,'ctype',datctype,'provider',datlocprovider,'icu_locale',to_jsonb(d)->>'daticulocale',
  'acl',(SELECT jsonb_agg(to_jsonb(a) ORDER BY grantor,grantee,privilege_type,is_grantable) FROM aclexplode(COALESCE(datacl,acldefault('d',datdba))) a),
  'settings',(SELECT jsonb_agg(jsonb_build_array(setrole,ARRAY(SELECT v FROM unnest(setconfig) v ORDER BY v)) ORDER BY setrole) FROM pg_db_role_setting WHERE setdatabase=d.oid))::text
  FROM pg_database d WHERE datname=$1`, name).Scan(&value)
	if err != nil {
		t.Fatal(err)
	}
	return value
}

const populatedRestoreScript = `
source "$BACKUP_SOURCE"
project_default_db_name() { printf populated_target; }
load_instance_backup_policy_flags() { :; }
sql_dump_policy_flags_preview() { :; }
docker() {
    if [[ "$1" == exec ]]; then
        shift
        if [[ "$1" == -i ]]; then shift; fi
        shift
        "/usr/lib/postgresql/16/bin/$1" "${@:2}"
    else
        printf '%s\n' "$*" >> lifecycle.log
    fi
}
wait_for_instance_app() {
    touch waiting-for-readiness
    for ((attempt=0; attempt<300; attempt++)); do
        [[ -f reconciled ]] && return 0
        sleep 0.1
    done
    return 1
}
write_instance_database_backup proof backup.sql.gz fixture_owner postgres || exit 1
restore_instance proof backup.sql.gz
`

func TestGeneratedBackupWithUnmatchedDefinerRefusesBeforeSwapPostgres(t *testing.T) {
	owner, _, _ := startupGrantFixture(t)
	fixtureExec(t, owner, `CREATE TABLE system_db_version(version text);INSERT INTO system_db_version VALUES('fixture');
  CREATE FUNCTION public.unmatched_restore_definer() RETURNS int LANGUAGE sql SECURITY DEFINER AS $$SELECT 99$$`)
	fixtureExec(t, owner, `CREATE DATABASE populated_target`)
	var socket string
	var port int
	if err := owner.QueryRow(`SELECT current_setting('unix_socket_directories'),current_setting('port')::int`).Scan(&socket, &port); err != nil {
		t.Fatal(err)
	}
	target, err := sql.Open("postgres", fmt.Sprintf("host=%s port=%d user=fixture_owner dbname=populated_target sslmode=disable", socket, port))
	if err != nil {
		t.Fatal(err)
	}
	defer target.Close()
	fixtureExec(t, target, `CREATE TABLE old_only(id int);INSERT INTO old_only VALUES(42)`)
	root := t.TempDir()
	instance := filepath.Join(root, "instances", "proof")
	if err := os.MkdirAll(instance, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(instance, ".env"), []byte("DB_ADMIN_USER=fixture_owner\nDB_NAME=populated_target\nAPP_PORT=1\n"), 0600); err != nil {
		t.Fatal(err)
	}
	source, err := filepath.Abs("../../../server_tools/ctl/lib/instance_backup.sh")
	if err != nil {
		t.Fatal(err)
	}
	// Readiness must not be reached, so fail it immediately if pre-swap checks regress.
	script := strings.Replace(populatedRestoreScript, "touch waiting-for-readiness", "touch waiting-for-readiness; return 1", 1)
	cmd := exec.Command("bash", "-c", script)
	cmd.Dir = root
	cmd.Env = append(os.Environ(), "BACKUP_SOURCE="+source, "EASELECT_RESTORE_CONFIRM=yes", "PGHOST="+socket, fmt.Sprintf("PGPORT=%d", port), "PGUSER=fixture_owner")
	output, err := cmd.CombinedOutput()
	if err == nil {
		t.Fatal("unmatched definer restore succeeded", string(output))
	}
	evidenceFiles, err := filepath.Glob(filepath.Join(instance, "backups", "restore_*.txt"))
	if err != nil || len(evidenceFiles) != 1 {
		t.Fatal("missing recovery evidence", evidenceFiles, err)
	}
	evidence, err := os.ReadFile(evidenceFiles[0])
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(evidence), "phase=function_security_failed") || strings.Contains(string(evidence), "phase=installed") {
		t.Fatal("unknown definer was not refused before swap", string(evidence), string(output))
	}
	var value int
	if err := target.QueryRow(`SELECT id FROM old_only`).Scan(&value); err != nil || value != 42 {
		t.Fatal("original database was changed", value, err)
	}
	var originalConnectable bool
	if err := owner.QueryRow(`SELECT datallowconn FROM pg_database WHERE datname='populated_target'`).Scan(&originalConnectable); err != nil || !originalConnectable {
		t.Fatal("original name/connections changed", err)
	}
	if _, err := os.Stat(filepath.Join(root, "waiting-for-readiness")); !os.IsNotExist(err) {
		t.Fatal("refused restore reached readiness", err)
	}
}
