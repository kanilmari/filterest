// legacy_trigger_attachments_postgres_test.go
// Checks the reviewed legacy attachments and their real PostgreSQL side effects.
// Reads only the existing public fixture bodies in a throwaway cluster.
// Proves narrow parent writes, body/path/owner refusals and denied account writes.
package runtime_grants

import (
	"context"
	"database/sql"
	"github.com/lib/pq"
	"testing"
)

func TestReviewedLegacyAttachmentsPostgres(t *testing.T) {
	owner, connect := grantDisposableDB(t)
	config := RoleConfiguration{Names: map[string]string{"basic": "legacy basic", "guest": "legacy guest", "readonly": "legacy readonly", "confidential": "legacy confidential"}}
	for _, name := range config.Names {
		fixtureExec(t, owner, "CREATE ROLE "+pq.QuoteIdentifier(name)+" LOGIN")
	}
	fixtureExec(t, owner, `CREATE TABLE app_service_catalog(id integer PRIMARY KEY,updated timestamptz,cached_username text,user_id integer,header text,description text,keywords_static text,search_vector tsvector);
 CREATE TABLE app_service_locations(id integer PRIMARY KEY,service_id integer,title text,street text,city text,state text,private_note text);
 CREATE TABLE system_users(id integer PRIMARY KEY,username text);
 CREATE VIEW systemview_role_table_privileges AS SELECT 'SELECT'::text AS privilege,'public'::text AS table_schema,'app_service_locations'::text AS table_name,'legacy basic'::text AS role_name;
 INSERT INTO app_service_catalog(id,updated,cached_username,user_id) VALUES(1,'2000-01-01 UTC',NULL,2)`)
	for _, fixture := range legacyTriggerFixtures(t) {
		if _, ok := reviewedLegacyTriggers[fixture.digest]; ok {
			fixtureExec(t, owner, fixture.definition)
		}
	}
	fixtureExec(t, owner, publicTimestampDefinition(t))
	fixtureExec(t, owner, `CREATE TRIGGER location_touch AFTER INSERT OR UPDATE OR DELETE ON app_service_locations FOR EACH ROW EXECUTE FUNCTION tg_location_touch_parent();
 CREATE TRIGGER parent_search BEFORE INSERT OR UPDATE ON app_service_catalog FOR EACH ROW EXECUTE FUNCTION tg_upd_service_searchvec();
 CREATE TRIGGER parent_timestamp BEFORE UPDATE ON app_service_catalog FOR EACH ROW EXECUTE FUNCTION set_service_catalog_updated_timestamp();
 CREATE TRIGGER username_sync AFTER UPDATE OF username ON system_users FOR EACH ROW EXECUTE FUNCTION fn_sync_cached_username();
 CREATE TRIGGER privilege_edit INSTEAD OF INSERT OR UPDATE OR DELETE ON systemview_role_table_privileges FOR EACH ROW EXECUTE FUNCTION systemview_role_table_privileges_upd()`)
	snapshot := GrantSnapshot{Objects: map[int64]Object{}}
	for _, name := range []string{"app_service_catalog", "app_service_locations", "system_users", "systemview_role_table_privileges"} {
		var oid int64
		if err := owner.QueryRow(`SELECT to_regclass($1)::oid`, name).Scan(&oid); err != nil {
			t.Fatal(err)
		}
		snapshot.Objects[oid] = Object{OID: oid, Schema: "public", Name: name, Kind: "table"}
	}
	for label, name := range config.Names {
		var oid int64
		if err := owner.QueryRow(`SELECT oid FROM pg_roles WHERE rolname=$1`, name).Scan(&oid); err != nil {
			t.Fatal(err)
		}
		snapshot.Roles = append(snapshot.Roles, Role{Label: label, Name: name, OID: oid})
	}
	check := func(wantBlocked bool) {
		t.Helper()
		tx, err := owner.BeginTx(context.Background(), &sql.TxOptions{ReadOnly: true})
		if err != nil {
			t.Fatal(err)
		}
		defer tx.Rollback()
		s := snapshot
		s.Blockers = nil
		s.Dependencies = nil
		if err := readTriggerDependencies(context.Background(), tx, &s); err != nil || HasBlockers(s.Blockers) != wantBlocked {
			t.Fatal(err, s.Blockers)
		}
		if !wantBlocked && (len(s.Dependencies) != 2) {
			t.Fatal(s.Dependencies)
		}
	}
	check(false)
	fixtureExec(t, owner, `GRANT USAGE ON SCHEMA public TO "legacy basic"; GRANT INSERT ON app_service_locations TO "legacy basic";
 GRANT UPDATE(updated),SELECT(id) ON app_service_catalog TO "legacy basic";
 GRANT SELECT(service_id,title,street,city,state) ON app_service_locations TO "legacy basic"`)
	basic := connect(config.Names["basic"])
	if _, err := basic.Exec(`INSERT INTO app_service_locations(id,service_id,title) VALUES(1,1,'Helsinki')`); err != nil {
		t.Fatal(err)
	}
	var touched bool
	if err := owner.QueryRow(`SELECT updated>'2000-01-01 UTC' FROM app_service_catalog WHERE id=1`).Scan(&touched); err != nil || !touched {
		t.Fatal(touched, err)
	}
	var vectorUpdated bool
	if err := owner.QueryRow(`SELECT search_vector @@ to_tsquery('finnish','helsinki') FROM app_service_catalog WHERE id=1`).Scan(&vectorUpdated); err != nil || !vectorUpdated {
		t.Fatal("recursive search vector not updated", vectorUpdated, err)
	}
	narrowRows, err := basic.Query(`SELECT service_id,title,street,city,state FROM app_service_locations`)
	if err != nil {
		t.Fatal("narrow location reads missing", err)
	}
	narrowRows.Close()
	if _, err := basic.Query(`SELECT private_note FROM app_service_locations`); err == nil {
		t.Fatal("location private field readable")
	}
	fixtureExec(t, owner, `CREATE SCHEMA legacy_shadow; CREATE TABLE legacy_shadow.app_service_catalog(id integer,updated timestamptz);
	 ALTER FUNCTION tg_location_touch_parent() SET search_path=legacy_shadow,public`)
	check(true)
	fixtureExec(t, owner, `ALTER FUNCTION tg_location_touch_parent() RESET search_path`)
	check(false)
	fixtureExec(t, owner, `CREATE ROLE changed_invoker_owner; ALTER FUNCTION tg_location_touch_parent() OWNER TO changed_invoker_owner`)
	check(false)
	fixtureExec(t, owner, `CREATE ROLE legacy_owner_bridge; GRANT changed_invoker_owner TO legacy_owner_bridge`)
	for _, role := range snapshot.Roles {
		// Direct runtime ownership and membership through a trusted owner both
		// permit changing reviewed code, including a transitive NOINHERIT path.
		fixtureExec(t, owner, "ALTER FUNCTION tg_location_touch_parent() OWNER TO "+pq.QuoteIdentifier(role.Name))
		check(true)
		fixtureExec(t, owner, `ALTER FUNCTION tg_location_touch_parent() OWNER TO changed_invoker_owner`)
		fixtureExec(t, owner, "ALTER ROLE "+pq.QuoteIdentifier(role.Name)+" NOINHERIT; GRANT legacy_owner_bridge TO "+pq.QuoteIdentifier(role.Name))
		check(true)
		fixtureExec(t, owner, "REVOKE legacy_owner_bridge FROM "+pq.QuoteIdentifier(role.Name))
		check(false)
	}
	fixtureExec(t, owner, `ALTER FUNCTION tg_location_touch_parent() OWNER TO fixture_owner`)
	check(false)
	for _, statement := range []string{`UPDATE app_service_catalog SET cached_username='denied' WHERE id=1`, `UPDATE system_users SET username='denied'`, `DELETE FROM systemview_role_table_privileges`} {
		if _, err := basic.Exec(statement); err == nil {
			t.Fatal("limited role wrote protected data", statement)
		}
	}
	fixtureExec(t, owner, `ALTER FUNCTION systemview_role_table_privileges_upd() SET search_path=public`)
	check(true)
	fixtureExec(t, owner, `ALTER FUNCTION systemview_role_table_privileges_upd() RESET search_path`)
	check(false)
	fixtureExec(t, owner, `CREATE ROLE different_legacy_owner; ALTER FUNCTION systemview_role_table_privileges_upd() OWNER TO different_legacy_owner`)
	check(true)
	fixtureExec(t, owner, `ALTER FUNCTION systemview_role_table_privileges_upd() OWNER TO fixture_owner`)
	check(false)
	fixtureExec(t, owner, `ALTER FUNCTION set_service_catalog_updated_timestamp() SECURITY DEFINER`)
	check(true)
	fixtureExec(t, owner, `ALTER FUNCTION set_service_catalog_updated_timestamp() SECURITY INVOKER`)
	check(false)
	for _, fixture := range legacyTriggerFixtures(t) {
		if fixture.name != "tg_location_touch_parent" {
			continue
		}
		fixtureExec(t, owner, "CREATE OR REPLACE FUNCTION public.tg_location_touch_parent() RETURNS trigger LANGUAGE plpgsql AS "+pq.QuoteLiteral(fixture.body+" "))
		check(true)
	}
}
