// review_regressions_postgres_test.go
// Verifies the accepted review fixes with separate identities and real PostgreSQL.
// Starts only disposable clusters through the existing opt-in fixture helper.
// Proves shadow-path refusal, picture adoption, predicate access and product locks.
package runtime_grants

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"easelect/backend/core_components/dynamic_table_tools/dtt_asset_linking"
	"easelect/backend/core_components/dynamic_table_tools/dtt_card_picture"
	"easelect/backend/core_components/runtimepaths"

	"github.com/lib/pq"
)

func reviewPostgresFixture(t *testing.T) (*sql.DB, func(string) *sql.DB, RoleConfiguration, string) {
	t.Helper()
	owner, connect := grantDisposableDB(t)
	config := RoleConfiguration{Names: map[string]string{"basic": "review basic", "guest": "review guest", "readonly": "review readonly", "confidential": "review confidential"}, ProtectedNames: []string{"fixture_owner"}}
	const auditRole = "review independent audit"
	for _, name := range append([]string{auditRole}, config.Names["basic"], config.Names["guest"], config.Names["readonly"], config.Names["confidential"]) {
		fixtureExec(t, owner, "CREATE ROLE "+pq.QuoteIdentifier(name)+" LOGIN")
	}
	fixtureExec(t, owner, `REVOKE CREATE ON SCHEMA public FROM PUBLIC`)
	fixture, err := os.ReadFile("testdata/grant_catalogue.sql")
	if err != nil {
		t.Fatal(err)
	}
	fixtureExec(t, owner, string(fixture))
	return owner, connect, config, auditRole
}

func TestReviewedDefinerShadowSearchPathPostgres(t *testing.T) {
	owner, connect, config, auditRole := reviewPostgresFixture(t)
	fixtureExec(t, owner, `CREATE TABLE system_row_access_rules(table_uid bigint,row_id bigint,action_id bigint,effect text,valid_from timestamptz,valid_until timestamptz,user_id bigint,group_id bigint);
 CREATE TABLE system_permission_actions(id bigint,enabled boolean,scope_type text,action_key text);
 CREATE SCHEMA shadow;
 CREATE TABLE shadow.effects(id integer);
 CREATE FUNCTION shadow.now() RETURNS timestamptz LANGUAGE plpgsql VOLATILE AS $$ BEGIN INSERT INTO shadow.effects VALUES(1); RETURN pg_catalog.now(); END $$;
 INSERT INTO system_permission_actions VALUES(1,true,'row','read');
 INSERT INTO system_row_access_rules VALUES(1,1,1,'allow','2000-01-01',NULL,2,NULL)`)
	fixtureExec(t, owner, "GRANT SELECT ON ALL TABLES IN SCHEMA public TO "+pq.QuoteIdentifier(auditRole))
	identity := reviewedDefinerBodies["8c5a769a59dfaa06a4c1ce947ff562b9"]
	definition, _, _ := newestDefinerMigrationFunction(t, identity)
	fixtureExec(t, owner, definition)
	auditor := connect(auditRole)
	var unsafe bool
	if err := auditor.QueryRow(auditorMayWriteSQL, string(reviewedDefinerBodiesJSON())).Scan(&unsafe); err != nil || unsafe {
		t.Fatal("exact path rejected", unsafe, err)
	}
	fixtureExec(t, owner, `ALTER FUNCTION public.resolve_effective_row_access(text,bigint,bigint,text,boolean,boolean) SET search_path = shadow, pg_catalog, public`)
	var allowed bool
	if err := auditor.QueryRow(`SELECT public.resolve_effective_row_access('fresh_source',1,2,'read',false,false)`).Scan(&allowed); err != nil || !allowed {
		t.Fatal("shadow fixture did not execute", err)
	}
	var effects int
	if err := owner.QueryRow(`SELECT count(*) FROM shadow.effects`).Scan(&effects); err != nil || effects == 0 {
		t.Fatal("shadowing now() did not run with the resolver's privileges", effects, err)
	}
	if err := auditor.QueryRow(auditorMayWriteSQL, string(reviewedDefinerBodiesJSON())).Scan(&unsafe); err != nil || !unsafe {
		t.Fatal("identity check accepted shadow path", unsafe, err)
	}
	if _, err := AuditRuntimeGrants(context.Background(), auditor, config); err == nil {
		t.Fatal("altered resolver did not refuse audit identity")
	}
	tx, err := owner.BeginTx(context.Background(), &sql.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	snapshot, err := LoadGrantSnapshot(context.Background(), tx, config)
	if err != nil {
		t.Fatal(err)
	}
	var paths []Finding
	if err := readSQLPathBlockers(context.Background(), tx, snapshot, &paths); err != nil {
		t.Fatal(err)
	}
	var resolver int64
	if err := tx.QueryRow(`SELECT 'public.resolve_effective_row_access(text,bigint,bigint,text,boolean,boolean)'::regprocedure::oid`).Scan(&resolver); err != nil {
		t.Fatal(err)
	}
	for _, findings := range [][]Finding{snapshot.Blockers, paths} {
		for _, role := range snapshot.Roles {
			if !hasFinding(findings, role.Label, "blocker", "function", resolver) {
				t.Fatal("SQL-path pass accepted shadow path", role.Label, findings)
			}
		}
	}
}

func TestSharedGalleryUpdateOnlyAdoptionPostgres(t *testing.T) {
	owner, connect, config, _ := reviewPostgresFixture(t)
	fixtureExec(t, owner, `DELETE FROM system_triggers;
 DELETE FROM system_group_table_func_rights;
 CREATE TABLE gallery_parent(id integer PRIMARY KEY,cached_image text);
 CREATE TABLE gallery_assets(id serial PRIMARY KEY,parent_id integer,filename text,asset_kind text,sort_order integer,is_primary boolean,metadata_json jsonb);
 CREATE TABLE gallery_attachments(id integer PRIMARY KEY,parent_id integer,stored_name text,private text);
 INSERT INTO system_db_tables VALUES(18,8,'gallery_parent','public','gallery_parent'::regclass::oid,NULL),(19,9,'gallery_assets','public','gallery_assets'::regclass::oid,NULL),(20,10,'gallery_attachments','public','gallery_attachments'::regclass::oid,NULL);
 INSERT INTO system_group_table_func_rights VALUES(2,3,9);
 INSERT INTO system_foreign_key_relations_1_m VALUES
 (9,8,'parent_id','id',NULL,false,'{"file_upload":{"filename_column":"filename","profiles":{"image":{"asset_kinds":["image"]}}}}',80),
 (10,8,'parent_id','id',NULL,false,'{"file_upload":{"filename_column":"stored_name","profile_key":"attachment"}}',81);
 INSERT INTO gallery_parent VALUES(1,'8_1_1.jpg');
 INSERT INTO gallery_assets(parent_id,filename,asset_kind,sort_order,is_primary) VALUES(1,'8_1_2.jpg','image',1,false);
 INSERT INTO gallery_attachments VALUES(1,1,'attachment.pdf','private attachment')`)
	s := readFixtureSnapshot(t, owner, config)
	grants := grantsFor(t, s)
	applyFixtureGrants(t, owner, s, grants)
	// Product metadata reads stay with the runtime roles until stage 2c (plan V2: reads are add-only here), and the
	// canonical rule discovers the gallery through them, as it does on a site.
	fixtureExec(t, owner, "GRANT SELECT ON system_foreign_key_relations_1_m, system_db_tables TO "+pq.QuoteIdentifier(config.Names["basic"]))
	basic := connect(config.Names["basic"])
	var private string
	if err := basic.QueryRow(`SELECT private FROM gallery_attachments`).Scan(&private); err == nil {
		t.Fatal("sibling private column was granted")
	}
	// The canonical rule sees a real surviving old picture and must adopt it.
	paths, err := runtimepaths.Resolve(t.TempDir(), t.TempDir(), true)
	if err != nil {
		t.Fatal(err)
	}
	configureReviewRuntimePaths(t, paths)
	folder := filepath.Join(paths.StorageRoot, "8", "1", "original")
	if err := os.MkdirAll(folder, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(folder, "8_1_1.jpg"), []byte("fixture picture"), 0600); err != nil {
		t.Fatal(err)
	}
	tx, err := basic.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`UPDATE gallery_assets SET is_primary=true WHERE id=1`); err != nil {
		t.Fatal(err)
	}
	gallery, err := dtt_card_picture.PictureRelationOf(tx, "gallery_parent")
	if err != nil || gallery == nil {
		t.Fatal("canonical gallery discovery", err)
	}
	if err := dtt_asset_linking.ApplyCardPictureRule(tx, "gallery_parent", gallery, []int64{1}, nil); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	var preview string
	var adopted int
	if err := owner.QueryRow(`SELECT cached_image FROM gallery_parent WHERE id=1`).Scan(&preview); err != nil || preview != "8_1_2.jpg" {
		t.Fatal("preview stale after update-only mutation", preview, err)
	}
	if err := owner.QueryRow(`SELECT count(*) FROM gallery_assets WHERE filename='8_1_1.jpg'`).Scan(&adopted); err != nil || adopted != 1 {
		t.Fatal("previous picture not preserved", adopted, err)
	}
}

func TestUploadCacheAndFallbackPermissionsPostgres(t *testing.T) {
	owner, connect, config, _ := reviewPostgresFixture(t)
	fixtureExec(t, owner, `DELETE FROM system_triggers;
 DELETE FROM system_group_table_func_rights;
 CREATE TABLE cache_destination(id integer PRIMARY KEY,reference_key integer,cached_name text,private text);
 CREATE TABLE direct_upload(id serial PRIMARY KEY,filename text,private text);
 INSERT INTO system_db_tables VALUES(18,8,'cache_destination','public','cache_destination'::regclass::oid,NULL),(19,9,'direct_upload','public','direct_upload'::regclass::oid,NULL);
 ALTER TABLE fresh_source ADD COLUMN reference_key integer;
 UPDATE system_foreign_key_relations_1_m SET target_column_name='reference_key',target_insert_specs='{"file_upload":{"filename_column":"filename","cache_targets":[{"table":"cache_destination","column":"cached_name"}]}}' WHERE id=1;
 INSERT INTO system_group_table_func_rights VALUES(2,2,3),(2,2,9);
 INSERT INTO cache_destination VALUES(1,7,'old','private cache')`)
	s := readFixtureSnapshot(t, owner, config)
	applyFixtureGrants(t, owner, s, grantsFor(t, s))
	basic := connect(config.Names["basic"])
	if _, err := basic.Exec(`UPDATE cache_destination SET cached_name='new' WHERE reference_key=7`); err != nil {
		t.Fatal("cache predicate lacked SELECT", err)
	}
	var text string
	for _, query := range []string{`SELECT private FROM cache_destination`, `SELECT cached_name FROM cache_destination`, `UPDATE direct_upload SET private='refused' RETURNING private`} {
		if err := basic.QueryRow(query).Scan(&text); err == nil {
			t.Fatal("narrow requirement widened", query)
		}
	}
	var id int
	if err := basic.QueryRow(`INSERT INTO direct_upload DEFAULT VALUES RETURNING id`).Scan(&id); err != nil {
		t.Fatal(err)
	}
	if _, err := basic.Exec(`UPDATE direct_upload SET filename='uploaded.jpg' WHERE id=$1`, id); err != nil {
		t.Fatal("unconfigured upload filename UPDATE refused", err)
	}
}

func TestProductReferenceAndForbiddenDestinationAuditPostgres(t *testing.T) {
	owner, connect, config, auditRole := reviewPostgresFixture(t)
	fixtureExec(t, owner, `CREATE TABLE system_languages(id integer PRIMARY KEY,title text);
 CREATE TABLE language_content(id serial PRIMARY KEY,language_id integer REFERENCES system_languages(id));
 CREATE TABLE system_about(id integer PRIMARY KEY,cached_image text);
 INSERT INTO system_db_tables VALUES(18,8,'system_languages','public','system_languages'::regclass::oid,NULL),(19,9,'language_content','public','language_content'::regclass::oid,NULL);
 INSERT INTO system_group_table_func_rights VALUES(2,1,8),(2,2,9);
 INSERT INTO system_languages VALUES(1,'English');
 INSERT INTO system_triggers VALUES('fresh_source','system_about','{}',888)`)
	s := readFixtureSnapshot(t, owner, config)
	if grants, err := DesiredRuntimeGrants(s); err == nil || grants != nil {
		t.Fatal("pure policy accepted incompatible dependencies")
	}
	fixtureExec(t, owner, "GRANT SELECT ON system_languages TO "+pq.QuoteIdentifier(config.Names["basic"]))
	if err := connect(config.Names["basic"]).QueryRow(`SELECT id FROM system_languages WHERE id=1 FOR KEY SHARE`).Scan(new(int)); err == nil {
		t.Fatal("product write denial no longer protects reference locks")
	}
	fixtureExec(t, owner, "GRANT SELECT ON ALL TABLES IN SCHEMA public TO "+pq.QuoteIdentifier(auditRole))
	fixtureExec(t, owner, "GRANT UPDATE ON fresh_target TO "+pq.QuoteIdentifier(config.Names["basic"]))
	findings, err := AuditRuntimeGrants(context.Background(), connect(auditRole), config)
	if err != nil {
		t.Fatal(err)
	}
	if !hasFinding(findings, "basic", "missing", "table", oidByName(&s, "fresh_source")) || !hasFinding(findings, "basic", "excess_write", "table", oidByName(&s, "fresh_target")) {
		t.Fatal("incompatible dependency suppressed independent comparison", findings)
	}
	for _, reason := range []string{"system_about", "system_languages"} {
		found := false
		for _, finding := range findings {
			found = found || finding.Finding == "blocker" && strings.Contains(finding.Reason, reason)
		}
		if !found {
			t.Fatal("missing incompatible dependency blocker", reason, findings)
		}
	}
}

// Normalize the relative legacy defaults to an equivalent validated baseline
// before changing global paths. Cleanup must restore it and report any failure.
func configureReviewRuntimePaths(t *testing.T, paths runtimepaths.Paths) {
	t.Helper()
	previous := runtimepaths.Current()
	for _, field := range []*string{&previous.InstallationRoot, &previous.ApplicationRoot, &previous.DataRoot, &previous.StorageRoot, &previous.StorageDeletedRoot, &previous.RuntimeRoot} {
		absolute, err := filepath.Abs(*field)
		if err != nil {
			t.Fatal(err)
		}
		*field = absolute
	}
	if err := runtimepaths.Configure(previous); err != nil {
		t.Fatalf("validate runtime-path baseline: %v", err)
	}
	t.Cleanup(func() {
		if err := runtimepaths.Configure(previous); err != nil {
			t.Errorf("restore runtime-path baseline: %v", err)
		}
	})
	if err := runtimepaths.Configure(paths); err != nil {
		t.Fatal(err)
	}
}
