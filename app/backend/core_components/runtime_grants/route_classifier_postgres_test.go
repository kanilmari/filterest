// route_classifier_postgres_test.go
// Proves administrator-only pilot reads and complete route blockers with real ACLs.
// Uses the existing isolated PostgreSQL fixture and separate custom role pools.
// Keeps this verification optional in environments without database access.
package runtime_grants

import (
	"context"
	"database/sql"
	"os"
	"reflect"
	"testing"

	"github.com/lib/pq"
)

func TestCodingAgentPilotAndUnknownRoutesPostgres(t *testing.T) {
	owner, connect := grantDisposableDB(t)
	config := RoleConfiguration{Names: map[string]string{"basic": "route basic", "guest": "route guest", "readonly": "route readonly", "confidential": "route confidential"}, ProtectedNames: []string{"fixture_owner"}}
	for _, name := range config.Names {
		fixtureExec(t, owner, "CREATE ROLE "+pq.QuoteIdentifier(name)+" LOGIN")
	}
	const auditRole = "route independent audit"
	fixtureExec(t, owner, "CREATE ROLE "+pq.QuoteIdentifier(auditRole)+" LOGIN")
	fixtureExec(t, owner, `REVOKE CREATE ON SCHEMA public FROM PUBLIC`)
	fixture, err := os.ReadFile("testdata/grant_catalogue.sql")
	if err != nil {
		t.Fatal(err)
	}
	fixtureExec(t, owner, string(fixture))
	fixtureExec(t, owner, `CREATE TABLE probe_label(id integer PRIMARY KEY,title text,private text);
 CREATE TABLE app_service_catalog(id serial PRIMARY KEY,target_id integer REFERENCES probe_label(id),title text);
 INSERT INTO system_db_tables VALUES(18,8,'app_service_catalog','public','app_service_catalog'::regclass::oid,NULL),(19,9,'probe_label','public','probe_label'::regclass::oid,'title');
 INSERT INTO system_functions VALUES(72602,'/api/app/ai-chat/codex-query',false,false,true);
 INSERT INTO system_group_table_func_rights VALUES(1,72602,8),(2,72602,8),(3,72602,8),(1,72602,9),(2,72602,9),(3,72602,9);
 INSERT INTO probe_label VALUES(1,'probe label','private label');
 INSERT INTO app_service_catalog(target_id,title) VALUES(1,'probe row')`)
	fixtureExec(t, owner, "GRANT SELECT ON ALL TABLES IN SCHEMA public TO "+pq.QuoteIdentifier(auditRole))
	basic, guest, auditor := connect(config.Names["basic"]), connect(config.Names["guest"]), connect(auditRole)
	snapshot := readFixtureSnapshot(t, owner, config)
	applyFixtureGrants(t, owner, snapshot, grantsFor(t, snapshot))
	var title string
	if err := basic.QueryRow(`SELECT title FROM app_service_catalog WHERE id=1`).Scan(&title); err != nil {
		t.Fatal("administrator probe cannot read through basic", err)
	}
	if err := basic.QueryRow(`SELECT title FROM probe_label WHERE id=1`).Scan(&title); err != nil {
		t.Fatal("administrator probe label dependency missing", err)
	}
	for _, query := range []string{
		`SELECT private FROM probe_label WHERE id=1`,
		`INSERT INTO app_service_catalog(title) VALUES('refused') RETURNING title`,
		`UPDATE app_service_catalog SET title='refused' WHERE id=1 RETURNING title`,
		`DELETE FROM app_service_catalog WHERE id=1 RETURNING title`,
		`SELECT nextval('app_service_catalog_id_seq')::text`,
	} {
		if err := basic.QueryRow(query).Scan(&title); err == nil {
			t.Fatal("probe granted unrelated access", query)
		}
	}
	if err := guest.QueryRow(`SELECT title FROM app_service_catalog WHERE id=1`).Scan(&title); err == nil {
		t.Fatal("administrator-only probe granted guest reads")
	}
	fixtureExec(t, owner, `DELETE FROM system_group_table_func_rights WHERE user_group_id=1 AND function_id=72602`)
	customGroups := readFixtureSnapshot(t, owner, config)
	pilot, label := oidByUID(&snapshot, 8), oidByUID(&snapshot, 9)
	if !containsGrant(grantsFor(t, customGroups), "basic", pilot, "", "SELECT") {
		t.Fatal("administrator right held through a custom group lost its pilot read")
	}
	fixtureExec(t, owner, `DELETE FROM system_group_table_func_rights WHERE function_id=72602`)
	withoutConsumer := readFixtureSnapshot(t, owner, config)
	grants := grantsFor(t, withoutConsumer)
	if containsGrant(grants, "basic", pilot, "", "SELECT") || containsGrant(grants, "basic", label, "title", "SELECT") {
		t.Fatal("last probe right removal kept its grants")
	}
	fixtureExec(t, owner, `INSERT INTO system_functions VALUES(80001,'/api/unclassified-first',NULL,false,true),(80002,'/api/unclassified-second',false,false,true);
 INSERT INTO system_group_table_func_rights VALUES(2,80001,8),(3,80002,8)`)
	tx, err := owner.BeginTx(context.Background(), &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if err != nil {
		t.Fatal(err)
	}
	incomplete, err := LoadGrantSnapshot(context.Background(), tx, config)
	tx.Rollback()
	if err != nil {
		t.Fatal(err)
	}
	if len(incomplete.Blockers) != 2 {
		t.Fatal("unknown functions not reported together", incomplete.Blockers)
	}
	if grants, err := DesiredDatasetRuntimeGrants(incomplete, 8); err == nil || grants != nil {
		t.Fatal("incomplete snapshot produced dataset grants")
	}
	before := aclFingerprint(t, owner)
	findings, err := AuditRuntimeGrants(context.Background(), auditor, config)
	if err != nil {
		t.Fatal(err)
	}
	var routes []Finding
	for _, finding := range findings {
		if finding.Kind == "route" {
			routes = append(routes, finding)
		}
	}
	if !reflect.DeepEqual(routes, unclassifiedRouteFindings(incomplete)) || !hasFinding(findings, "basic", "excess_read_reported", "table", pilot) || !hasFinding(findings, "basic", "excess_read_reported", "column", label) {
		t.Fatal("route blockers prevented effective grant comparison", findings)
	}
	if aclFingerprint(t, owner) != before {
		t.Fatal("incomplete audit changed ACLs")
	}
}
