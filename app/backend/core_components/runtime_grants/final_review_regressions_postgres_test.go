// final_review_regressions_postgres_test.go
// Proves final-review boundaries with disposable PostgreSQL and distinct roles.
// Complements metadata-only regressions with effective permissions and real gallery work.
// Leaves site databases untouched; the supervising agent runs this opt-in suite.
package runtime_grants

import (
	"context"
	"strings"
	"testing"

	"github.com/lib/pq"
)

func TestSiteGuestIdentityPriceChartPostgres(t *testing.T) {
	owner, connect, config, _ := reviewPostgresFixture(t)
	fixtureExec(t, owner, `UPDATE system_user_groups SET name='unused' WHERE id=2;
 UPDATE system_user_groups SET name='users' WHERE id=3;
 UPDATE system_user_groups SET name='guests' WHERE id=4;
 CREATE TABLE app_price_chart(id integer PRIMARY KEY,title text);
 INSERT INTO app_price_chart VALUES(1,'signed-in-only');
 INSERT INTO system_db_tables VALUES(18,8,'app_price_chart','public','app_price_chart'::regclass::oid,NULL);
 INSERT INTO system_group_table_func_rights VALUES(3,1,8)`)
	s := readFixtureSnapshot(t, owner, config)
	price := oidByName(&s, "app_price_chart")
	grants := grantsFor(t, s)
	if s.GuestGroups[3] || !s.GuestGroups[4] || !s.GuestGroups[5] || containsGrant(grants, "guest", price, "", "SELECT") || !containsGrant(grants, "basic", price, "", "SELECT") {
		t.Fatal("site guest identity leaked users-only price chart", s.GuestGroups, grants)
	}
	applyFixtureGrants(t, owner, s, grants)
	var title string
	if err := connect(config.Names["basic"]).QueryRow(`SELECT title FROM app_price_chart WHERE id=1`).Scan(&title); err != nil {
		t.Fatal("users price-chart read missing", err)
	}
	if err := connect(config.Names["guest"]).QueryRow(`SELECT title FROM app_price_chart WHERE id=1`).Scan(&title); err == nil {
		t.Fatal("guest can read users-only chart")
	}
}

func TestStandaloneSequenceAuditIsolationPostgres(t *testing.T) {
	owner, connect, config, auditRole := reviewPostgresFixture(t)
	fixtureExec(t, owner, `CREATE SEQUENCE standalone_sequence; CREATE SEQUENCE another_sequence`)
	fixtureExec(t, owner, "GRANT SELECT ON ALL TABLES IN SCHEMA public TO "+pq.QuoteIdentifier(auditRole))
	fixtureExec(t, owner, "GRANT UPDATE ON fresh_target TO "+pq.QuoteIdentifier(config.Names["basic"]))
	s := readFixtureSnapshot(t, owner, config)
	if grants, err := DesiredRuntimeGrants(s); err == nil || grants != nil || !strings.Contains(err.Error(), "unclassified sequence") {
		t.Fatal("pure policy accepted standalone sequence", grants, err)
	}
	before := aclFingerprint(t, owner)
	findings, err := AuditRuntimeGrants(context.Background(), connect(auditRole), config)
	if err != nil {
		t.Fatal(err)
	}
	var unknownSequences int
	for _, f := range findings {
		if f.Finding == "blocker" && f.Kind == "sequence" && strings.Contains(f.Reason, "unclassified sequence") {
			unknownSequences++
		}
	}
	target := oidByName(&s, "fresh_target")
	if unknownSequences != 2 || !hasFinding(findings, "basic", "missing", "table", oidByName(&s, "fresh_source")) || !hasFinding(findings, "basic", "excess_write", "table", target) || !hasDirectACLExcess(findings, target) {
		t.Fatal("standalone sequences hid independent effective/direct ACL findings", findings)
	}
	if before != aclFingerprint(t, owner) {
		t.Fatal("diagnostic audit changed privileges")
	}
}

func TestAboutGalleryRuntimeConsumerPostgres(t *testing.T) {
	owner, connect, config, auditRole := reviewPostgresFixture(t)
	fixtureExec(t, owner, `CREATE TABLE system_about(id integer PRIMARY KEY,cached_image text);
 CREATE TABLE system_about_assets(id serial PRIMARY KEY,system_about_id integer REFERENCES system_about(id) ON DELETE CASCADE,filename text,asset_kind text,is_primary boolean,sort_order integer);
 INSERT INTO system_db_tables VALUES(18,8,'system_about','public','system_about'::regclass::oid,NULL),(19,9,'system_about_assets','public','system_about_assets'::regclass::oid,NULL);
 INSERT INTO system_group_table_func_rights VALUES(1,3,9),(1,3,8);
 INSERT INTO system_foreign_key_relations_1_m VALUES(9,8,'system_about_id','id',NULL,true,'{"file_upload":{"filename_column":"filename","profiles":{"image":{}},"cache_targets":[{"table":"system_about","column":"cached_image"}]}}',80)`)
	fixtureExec(t, owner, "GRANT SELECT ON ALL TABLES IN SCHEMA public TO "+pq.QuoteIdentifier(auditRole))
	s := readFixtureSnapshot(t, owner, config)
	parent := oidByName(&s, "system_about")
	child := oidByName(&s, "system_about_assets")
	found := false
	for _, dependency := range s.Dependencies {
		found = found || dependency.Kind == "gallery" && dependency.SourceOID == child && dependency.TargetOID == parent
	}
	if !found {
		t.Fatal("site's real about gallery not discovered")
	}
	if containsGrant(grantsFor(t, s), "basic", parent, "cached_image", "UPDATE") {
		t.Fatal("administrator-only about gallery entered runtime pool")
	}
	auditor := connect(auditRole)
	findings, err := AuditRuntimeGrants(context.Background(), auditor, config)
	if err != nil || HasBlockers(findings) {
		t.Fatal("administrator-only about gallery caused a blocker", err, findings)
	}
	fixtureExec(t, owner, `INSERT INTO system_group_table_func_rights VALUES(2,3,9)`)
	s = readFixtureSnapshot(t, owner, config)
	if grants, err := DesiredRuntimeGrants(s); err == nil || grants != nil || !strings.Contains(err.Error(), "dependency gallery") {
		t.Fatal("ordinary about-gallery mutation accepted", grants, err)
	}
	findings, err = AuditRuntimeGrants(context.Background(), auditor, config)
	if err != nil || !hasFinding(findings, "policy", "blocker", "table", parent) {
		t.Fatal("active real about gallery omitted from blockers", err, findings)
	}
}

func TestUnusedSchemaRequirementsPostgres(t *testing.T) {
	owner, connect, config, auditRole := reviewPostgresFixture(t)
	fixtureExec(t, owner, `CREATE SCHEMA apps; CREATE SCHEMA postgis;
 CREATE TABLE apps.unused_dataset(id integer PRIMARY KEY,title text);
 INSERT INTO system_db_tables VALUES(18,8,'unused_dataset','apps','apps.unused_dataset'::regclass::oid,NULL)`)
	fixtureExec(t, owner, "GRANT SELECT ON ALL TABLES IN SCHEMA public TO "+pq.QuoteIdentifier(auditRole))
	s := readFixtureSnapshot(t, owner, config)
	assertUsage := func(wantBasic, wantGuest bool) {
		t.Helper()
		grants := grantsFor(t, s)
		for _, object := range s.Objects {
			if object.Kind == "schema" && (object.Name == "apps" || object.Name == "postgis") {
				for _, role := range []string{"basic", "guest"} {
					wanted := wantBasic
					if role == "guest" {
						wanted = wantGuest
					}
					if containsGrant(grants, role, object.OID, "", "USAGE") != (wanted && object.Name == "apps") {
						t.Fatal("unused/required schema grant differs", role, object.Name)
					}
				}
			}
		}
	}
	assertUsage(false, false)
	findings, err := AuditRuntimeGrants(context.Background(), connect(auditRole), config)
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range findings {
		if f.Kind == "schema" && f.Finding == "missing" && (f.Object == `"apps"` || f.Object == `"postgis"`) {
			t.Fatal("unused schema produced false missing requirement", f)
		}
	}
	fixtureExec(t, owner, `INSERT INTO system_group_table_func_rights VALUES(3,1,8)`)
	s = readFixtureSnapshot(t, owner, config)
	assertUsage(false, true)
	fixtureExec(t, owner, `INSERT INTO system_group_table_func_rights VALUES(2,1,8)`)
	s = readFixtureSnapshot(t, owner, config)
	assertUsage(true, true)
}
