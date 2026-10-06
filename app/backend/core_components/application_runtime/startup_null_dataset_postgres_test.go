// startup_null_dataset_postgres_test.go
// Keeps retained NULL dataset names from failing the full required startup.
// Both relationship discovery paths skip unusable catalogue identities.
// The final independent audit still reports each retained relation by its ID.
package application_runtime

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"easelect/backend/core_components/runtime_grants"
	"github.com/lib/pq"
)

func TestFullStartupPreservesRelationshipsToNullDatasetNamesPostgres(t *testing.T) {
	owner, config := bootstrapStartupFixture(t)
	if _, err := owner.Exec(`INSERT INTO system_db_tables(table_uid,table_name,schema_name) VALUES(940,NULL,'public')`); err != nil {
		t.Fatal(err)
	}
	var one, many int64
	if err := owner.QueryRow(`INSERT INTO system_foreign_key_relations_1_m(source_table_uid,target_table_uid,source_column_name,target_column_name) VALUES(940,10,'id','id') RETURNING id`).Scan(&one); err != nil {
		t.Fatal(err)
	}
	if err := owner.QueryRow(`INSERT INTO system_foreign_key_relations_m_m(bridging_table_uid,table_a_uid,table_b_uid,bridging_col_a,bridging_col_b,table_a_column,table_b_column) VALUES(7,940,10,'id','id','id','id') RETURNING id`).Scan(&many); err != nil {
		t.Fatal(err)
	}
	runBootstrapStartup(t)
	var retained int
	if err := owner.QueryRow(`SELECT count(*) FROM system_db_tables WHERE table_uid=940 AND table_name IS NULL`).Scan(&retained); err != nil || retained != 1 {
		t.Fatal("NULL registry entry lost", retained, err)
	}
	const auditRole = "NULL names independent audit"
	for _, statement := range []string{"CREATE ROLE " + pq.QuoteIdentifier(auditRole) + " LOGIN", `REVOKE CREATE ON SCHEMA public FROM PUBLIC`, "GRANT SELECT ON ALL TABLES IN SCHEMA public TO " + pq.QuoteIdentifier(auditRole)} {
		if _, err := owner.Exec(statement); err != nil {
			t.Fatal(statement, err)
		}
	}
	findings, err := runtime_grants.AuditRuntimeGrants(context.Background(), connectFixtureRole(t, owner, auditRole), config)
	if err != nil {
		t.Fatal(err)
	}
	for name, id := range map[string]int64{"system_foreign_key_relations_1_m": one, "system_foreign_key_relations_m_m": many} {
		var count int
		if err := owner.QueryRow("SELECT count(*) FROM "+pq.QuoteIdentifier(name)+" WHERE id=$1", id).Scan(&count); err != nil || count != 1 {
			t.Fatal("relationship lost", name, id, err)
		}
		found := false
		for _, f := range findings {
			if strings.Contains(f.Object, name) && strings.Contains(f.Reason, fmt.Sprintf("id %d:", id)) && f.Finding == "blocker" {
				found = true
			}
		}
		if !found {
			t.Fatal("audit omitted NULL-name relation", name, id, findings)
		}
	}
}
