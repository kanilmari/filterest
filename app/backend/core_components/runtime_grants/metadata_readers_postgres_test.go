// metadata_readers_postgres_test.go
// Verifies incomplete metadata and complete audit reporting in isolated PostgreSQL.
// Uses the shared audit fixture with NULL and dangling registry identities.
// Keeps catalogue-reader regressions separate from general ACL comparison tests.
package runtime_grants

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"reflect"
	"strings"
	"testing"

	"github.com/lib/pq"
)

func TestMetadataRowsAndCompleteAuditPostgres(t *testing.T) {
	owner, connect := grantDisposableDB(t)
	config := RoleConfiguration{Names: map[string]string{"basic": "metadata basic", "guest": "metadata guest", "readonly": "metadata readonly", "confidential": "metadata confidential"}, ProtectedNames: []string{"fixture_owner"}}
	for _, name := range config.Names {
		fixtureExec(t, owner, "CREATE ROLE "+pq.QuoteIdentifier(name)+" LOGIN")
	}
	const auditRole = "metadata independent audit"
	fixtureExec(t, owner, "CREATE ROLE "+pq.QuoteIdentifier(auditRole)+" LOGIN")
	fixtureExec(t, owner, `REVOKE CREATE ON SCHEMA public FROM PUBLIC`)
	fixture, err := os.ReadFile("testdata/grant_catalogue.sql")
	if err != nil {
		t.Fatal(err)
	}
	fixtureExec(t, owner, string(fixture))
	fixtureExec(t, owner, "GRANT SELECT ON ALL TABLES IN SCHEMA public TO "+pq.QuoteIdentifier(auditRole))
	auditor := connect(auditRole)
	withNull := readFixtureSnapshot(t, owner, config)
	if len(withNull.Findings) != 9 {
		t.Fatalf("NULL rows not all reported once: %+v", withNull.Findings)
	}
	for _, id := range []int64{757, 758, 759, 760, 761, 762, 763, 764} {
		count := 0
		for _, f := range withNull.Findings {
			if strings.Contains(f.Reason, fmt.Sprintf("id %d:", id)) {
				count++
			}
		}
		if count != 1 {
			t.Fatalf("row %d: %d preserved findings", id, count)
		}
	}
	grantsWithNull := grantsFor(t, withNull)
	findings, err := AuditRuntimeGrants(context.Background(), auditor, config)
	if err != nil || HasBlockers(findings) {
		t.Fatalf("NULL-only audit failed: %v %+v", err, findings)
	}
	// Compare the real fixture's complete policy before/after deleting only NULL
	// metadata. No test setup grant is applied to an incomplete snapshot.
	fixtureExec(t, owner, `DELETE FROM system_foreign_key_relations_1_m WHERE id IN (757,758,759);
 DELETE FROM system_db_tables WHERE id=760;
 DELETE FROM system_foreign_key_relations_m_m WHERE id IN (761,762,763);
 DELETE FROM system_row_actor_columns WHERE table_uid IS NULL;
 DELETE FROM system_triggers WHERE id=764`)
	clean := readFixtureSnapshot(t, owner, config)
	if !reflect.DeepEqual(grantsWithNull, grantsFor(t, clean)) {
		t.Fatal("NULL metadata changed valid-row policy results")
	}
	// The upload reader joins only the source UID. A NULL parent does not
	// make a direct upload into that registered source unreachable.
	fixtureExec(t, owner, `INSERT INTO system_foreign_key_relations_1_m VALUES(3,NULL,'parent_id',NULL,NULL,true,'{"file_upload":{"filename_column":"filename","cache_targets":[]}}',777)`)
	findings, err = AuditRuntimeGrants(context.Background(), auditor, config)
	if err != nil {
		t.Fatal(err)
	}
	uploadBlocker := false
	for _, finding := range findings {
		uploadBlocker = uploadBlocker || finding.Finding == "blocker" && strings.Contains(finding.Reason, "id 777:") && strings.Contains(finding.Reason, "direct upload")
	}
	if !uploadBlocker {
		t.Fatal("NULL target silently under-granted a reachable direct upload")
	}
	fixtureExec(t, owner, `DELETE FROM system_foreign_key_relations_1_m WHERE id=777`)
	// Re-add NULL rows alongside dangling rows in several readers. The audit
	// must reach later SQL-path readers, effective checks and ACL provenance.
	fixtureExec(t, owner, `INSERT INTO system_foreign_key_relations_1_m VALUES
 (NULL,1,NULL,NULL,NULL,true,'{"file_upload":{"cache_targets":true}}',757),
 (999,1,'parent_id','id',NULL,true,NULL,901),
 (3,999,'parent_id','id',NULL,true,NULL,902);
 INSERT INTO system_db_tables VALUES(904,999,'missing_registry_object','public',NULL,NULL);
 INSERT INTO system_foreign_key_relations_m_m VALUES(1,2,999,903);
 INSERT INTO system_row_actor_columns VALUES(888,'owner','owner_id');
 INSERT INTO system_triggers VALUES('fresh_source',NULL,NULL,906);
 INSERT INTO system_group_table_func_rights VALUES(2,1,999,905);
 CREATE FUNCTION fixture_metadata_unknown_trigger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
 CREATE TRIGGER fixture_metadata_unknown BEFORE UPDATE ON fresh_source FOR EACH ROW EXECUTE FUNCTION fixture_metadata_unknown_trigger()`)
	fixtureExec(t, owner, "GRANT UPDATE ON fresh_target TO "+pq.QuoteIdentifier(config.Names["basic"]))
	before := aclFingerprint(t, owner)
	findings, err = AuditRuntimeGrants(context.Background(), auditor, config)
	if err != nil || !HasBlockers(findings) {
		t.Fatalf("dangling audit: %v %+v", err, findings)
	}
	for _, entry := range []struct{ table, row, identity string }{
		{"system_foreign_key_relations_1_m", "901", "source_table_uid=999"},
		{"system_foreign_key_relations_1_m", "902", "target_table_uid=999"},
		{"system_foreign_key_relations_m_m", "903", "bridging_table_uid=999"},
		{"system_db_tables", "904", "table_uid=999"},
		{"system_group_table_func_rights", "905", "target_table_uid=999"},
		{"system_triggers", "906", "target_table="},
	} {
		found := false
		for _, f := range findings {
			if f.Finding == "blocker" && strings.Contains(f.Object, entry.table) && strings.Contains(f.Reason, "id "+entry.row+":") && strings.Contains(f.Reason, entry.identity) {
				found = true
			}
		}
		if !found {
			t.Errorf("missing identified blocker: %+v", entry)
		}
	}
	source, target := oidByName(&clean, "fresh_source"), oidByName(&clean, "fresh_target")
	if !hasFinding(findings, "basic", "missing", "table", source) || !hasFinding(findings, "basic", "excess_write", "table", target) {
		t.Fatal("audit stopped before valid-row comparisons")
	}
	triggerFound, nullFound, actorFound := false, false, false
	for _, f := range findings {
		triggerFound = triggerFound || f.Kind == "trigger" && f.Finding == "blocker"
		nullFound = nullFound || f.Finding == "preserved_outside_scope" && strings.Contains(f.Reason, "id 757:")
		actorFound = actorFound || f.Finding == "blocker" && strings.Contains(f.Object, "system_row_actor_columns") && strings.Contains(f.Reason, "888")
	}
	if !triggerFound || !nullFound || !actorFound {
		t.Fatalf("audit omitted later findings: %+v", findings)
	}
	var output bytes.Buffer
	if err := WriteFindings(&output, findings); err != nil {
		t.Fatal(err)
	}
	for _, private := range []string{auditRole, config.Names["basic"], "fixture_owner", "fixture-only value", "fixture row value", "must not be disclosed"} {
		if strings.Contains(output.String(), private) {
			t.Fatal("audit output disclosed private material")
		}
	}
	if aclFingerprint(t, owner) != before {
		t.Fatal("incomplete audit changed privileges")
	}
}
