// reviewed_invoker_owner_postgres_test.go
// Reproduces reviewed username/timestamp functions owned by another trusted role.
// Refuses direct ownership and transitive membership for all configured runtimes.
// Uses only the opt-in disposable PostgreSQL fixture and existing reviewed bytes.
package runtime_grants

import (
	"context"
	"database/sql"
	"testing"

	"github.com/lib/pq"
)

func TestReviewedAccountInvokersAcceptTrustedOwnersPostgres(t *testing.T) {
	owner, _ := grantDisposableDB(t)
	fixtureExec(t, owner, `CREATE TABLE system_users(id integer PRIMARY KEY,username text,updated timestamptz);
 CREATE ROLE trusted_invoker_owner; CREATE ROLE invoker_owner_bridge;
 GRANT trusted_invoker_owner TO invoker_owner_bridge`)
	snapshot := GrantSnapshot{Objects: map[int64]Object{}}
	var oid int64
	if err := owner.QueryRow(`SELECT 'system_users'::regclass::oid`).Scan(&oid); err != nil {
		t.Fatal(err)
	}
	snapshot.Objects[oid] = Object{OID: oid, Schema: "public", Name: "system_users", Kind: "table"}
	for _, label := range []string{"basic", "guest", "readonly", "confidential"} {
		name := "owner proof " + label + ` "custom"`
		fixtureExec(t, owner, "CREATE ROLE "+pq.QuoteIdentifier(name)+" NOINHERIT")
		var roleOID int64
		if err := owner.QueryRow(`SELECT oid FROM pg_roles WHERE rolname=$1`, name).Scan(&roleOID); err != nil {
			t.Fatal(err)
		}
		snapshot.Roles = append(snapshot.Roles, Role{Label: label, Name: name, OID: roleOID})
	}
	for _, fixture := range legacyTriggerFixtures(t) {
		if fixture.name == "fn_sync_cached_username" {
			fixtureExec(t, owner, fixture.definition)
		}
	}
	fixtureExec(t, owner, publicTimestampDefinition(t))
	// The other reviewed timestamp body, byte for byte as deployed sites carry it on several
	// registries (for example set_file_structure_updated_timestamp on the development database).
	fixtureExec(t, owner, "CREATE FUNCTION set_system_comments_updated_timestamp() RETURNS trigger LANGUAGE plpgsql AS $$\nBEGIN\n    NEW.updated = NOW();\n    RETURN NEW;\nEND;\n$$")
	fixtureExec(t, owner, `CREATE TRIGGER cached_username AFTER UPDATE OF username ON system_users
 FOR EACH ROW EXECUTE FUNCTION fn_sync_cached_username();
 CREATE TRIGGER user_timestamp BEFORE UPDATE ON system_users
 FOR EACH ROW EXECUTE FUNCTION set_service_catalog_updated_timestamp();
 CREATE TRIGGER legacy_user_timestamp BEFORE UPDATE ON system_users
 FOR EACH ROW EXECUTE FUNCTION set_system_comments_updated_timestamp();
 ALTER FUNCTION fn_sync_cached_username() OWNER TO trusted_invoker_owner;
 ALTER FUNCTION set_service_catalog_updated_timestamp() OWNER TO trusted_invoker_owner;
 ALTER FUNCTION set_system_comments_updated_timestamp() OWNER TO trusted_invoker_owner`)
	var timestampDigest string
	if err := owner.QueryRow(`SELECT md5(prosrc) FROM pg_proc WHERE oid='set_system_comments_updated_timestamp()'::regprocedure`).Scan(&timestampDigest); err != nil || timestampDigest != "aa05ff614a5b400f35158a3386e154d3" {
		t.Fatal("deployed legacy timestamp bytes changed", timestampDigest, err)
	}
	check := func(blocked bool) {
		t.Helper()
		tx, err := owner.BeginTx(context.Background(), &sql.TxOptions{ReadOnly: true})
		if err != nil {
			t.Fatal(err)
		}
		defer tx.Rollback()
		s := snapshot
		if err := readTriggerDependencies(context.Background(), tx, &s); err != nil || HasBlockers(s.Blockers) != blocked {
			t.Fatal("account trigger owner safety", blocked, err, s.Blockers)
		}
	}
	check(false)
	for _, function := range []string{"fn_sync_cached_username", "set_service_catalog_updated_timestamp", "set_system_comments_updated_timestamp"} {
		for _, role := range snapshot.Roles {
			fixtureExec(t, owner, "ALTER FUNCTION "+pq.QuoteIdentifier(function)+"() OWNER TO "+pq.QuoteIdentifier(role.Name))
			check(true)
			fixtureExec(t, owner, "ALTER FUNCTION "+pq.QuoteIdentifier(function)+"() OWNER TO trusted_invoker_owner")
			fixtureExec(t, owner, "GRANT invoker_owner_bridge TO "+pq.QuoteIdentifier(role.Name))
			check(true)
			fixtureExec(t, owner, "REVOKE invoker_owner_bridge FROM "+pq.QuoteIdentifier(role.Name))
			check(false)
		}
		fixtureExec(t, owner, "ALTER FUNCTION "+pq.QuoteIdentifier(function)+"() SET search_path=public")
		check(true)
		fixtureExec(t, owner, "ALTER FUNCTION "+pq.QuoteIdentifier(function)+"() RESET search_path")
		check(false)
	}
}
