// rls_pilot_protection_postgres_test.go
// Proves pilot visibility under missing protection and privileged reading roles.
// Bridges real PostgreSQL policies with listing, count, search and relation compilers.
// Runs only in disposable clusters; no application database or provider is contacted.
package dtt_1_row_read

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/url"
	"reflect"
	"sort"
	"strings"
	"testing"

	"easelect/backend/core_components/dbutils"
	"github.com/lib/pq"
	pgvector "github.com/pgvector/pgvector-go"
)

func pilotProtectionPostgres(t *testing.T) (*sql.DB, *sql.DB) {
	t.Helper()
	owner, reader := rowGroupPostgres(t) // Opt-in/skip and isolated cluster lifecycle are shared.
	const fixture = `
DROP POLICY wl103_pilot_read ON app_service_catalog;
ALTER TABLE app_service_catalog
 ADD COLUMN admin_reviewed boolean NOT NULL DEFAULT true,
 ADD COLUMN admin_approved boolean NOT NULL DEFAULT true,
 ADD COLUMN parent_id integer NOT NULL DEFAULT 9;
INSERT INTO system_column_details VALUES (3, 'admin_reviewed', true), (3, 'admin_approved', true);
INSERT INTO app_service_catalog (id,title,user_id,published,enabled,admin_reviewed,admin_approved) VALUES
 (170,'unreviewed',12,true,true,false,true), (171,'unapproved',12,true,true,true,false),
 (172,'null owner',NULL,false,true,true,true);
-- A direct allowance must not bypass any mandatory moderation flag.
INSERT INTO system_row_access_rules (table_uid,action_id,row_id,user_id,effect) VALUES (3,1,170,8,'allow');
GRANT UPDATE ON app_service_catalog TO wl58_reader;
CREATE EXTENSION IF NOT EXISTS vector;
ALTER TABLE app_service_catalog ADD COLUMN embedding_vector vector(3) DEFAULT '[1,0,0]';
`
	if _, err := owner.Exec(fixture); err != nil {
		t.Fatal(err)
	}
	for _, policy := range pilotExpectedPolicies {
		commands := map[string]string{"r": "SELECT", "a": "INSERT", "w": "UPDATE", "d": "DELETE"}
		query := fmt.Sprintf("CREATE POLICY %s ON public.app_service_catalog FOR %s TO PUBLIC", pq.QuoteIdentifier(policy.name), commands[policy.command])
		if policy.using != "" {
			query += " USING (" + policy.using + ")"
		}
		if policy.check != "" {
			query += " WITH CHECK (" + policy.check + ")"
		}
		if _, err := owner.Exec(query); err != nil {
			t.Fatal(err)
		}
	}
	return owner, reader
}

func pilotReadTx(t *testing.T, db *sql.DB, userID int) *sql.Tx {
	t.Helper()
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = tx.Rollback() })
	if err := dbutils.ApplyRequestActorToTx(tx, dbutils.NewRequestActorContext(userID, "basic")); err != nil {
		t.Fatal(err)
	}
	return tx
}

func assertPilotProtection(t *testing.T, tx *sql.Tx, userID int, want bool) {
	t.Helper()
	var verified bool
	if err := tx.QueryRow(pilotProtectionQuery(userID)).Scan(&verified); err != nil {
		t.Fatal(err)
	}
	if verified != want {
		t.Fatalf("verified protection = %t, want %t", verified, want)
	}
}

// Execute the same builders used by the named endpoints, rather than counting
// SQL fragments alone. The fixture exposes hidden rows to a bypassing role and
// gives one hidden row a direct allow, so a removed fallback actually leaks.
func assertPilotReadSurfaces(t *testing.T, tx *sql.Tx, want []int) {
	t.Helper()
	policy, err := getLegacyMustTrueReadPolicy(tx, rlsPilotTableName)
	if err != nil {
		t.Fatal(err)
	}
	ctx := rowGroupListingContext(t, tx, rlsPilotTableName, "basic", 8, url.Values{})
	ids, count, _ := rowGroupListing(t, ctx)
	if !reflect.DeepEqual(ids, want) || count != len(want) {
		t.Fatalf("listing ids=%v count=%d want=%v", ids, count, want)
	}
	count, err = getRowCountWithReadPolicy(tx, rlsPilotTableName, "basic", 8, policy)
	if err != nil || count != len(want) {
		t.Fatalf("count=%d err=%v want=%d", count, err, len(want))
	}

	where, args := appendReadPolicyToWhereClause(rlsPilotTableName, "basic", 8, policy, " WHERE id IS NOT NULL AND title IS NOT NULL", nil)
	for _, surface := range []string{"filter_options", "vector_hydration"} {
		query := "SELECT DISTINCT id FROM app_service_catalog" + where + " ORDER BY id LIMIT 500"
		if got := rowGroupQueryIDs(t, tx, query, args); !reflect.DeepEqual(got, want) {
			t.Fatalf("%s ids=%v want=%v", surface, got, want)
		}
	}
	authorization := intelligentSearchAuthorization{userRole: "basic", userID: 8, readPolicy: policy}
	for _, alias := range []string{"src", "candidate"} {
		condition, searchArgs, err := appendIntelligentSearchAuthorizationCondition(rlsPilotTableName, alias, authorization, nil)
		if err != nil {
			t.Fatal(err)
		}
		query := fmt.Sprintf("SELECT %s.id FROM app_service_catalog AS %s WHERE %s ORDER BY %s.id LIMIT 100", alias, alias, condition, alias)
		if got := rowGroupQueryIDs(t, tx, query, searchArgs); !reflect.DeepEqual(got, want) {
			t.Fatalf("intelligent %s ids=%v want=%v", alias, got, want)
		}
	}
	// Real local semantic ranking checks candidate authorization before LIMIT.
	hits, err := fetchSimilarRows(tx, rlsPilotTableName, "", pgvector.NewVector([]float32{1, 0, 0}), authorization, semanticSources{General: true}, 100)
	if err != nil {
		t.Fatal(err)
	}
	semanticIDs := []int{}
	for _, hit := range hits {
		semanticIDs = append(semanticIDs, hit.RowID)
	}
	sort.Ints(semanticIDs)
	if !reflect.DeepEqual(semanticIDs, want) {
		t.Fatalf("semantic ids=%v want=%v", semanticIDs, want)
	}

	query, relatedArgs := buildRelatedItemsQueryWithReadPolicy(`"app_service_catalog"."id"`, rlsPilotTableName, "", "parent_id", 9, "basic", 8, policy, "id")
	if got := rowGroupQueryIDs(t, tx, query, relatedArgs); !reflect.DeepEqual(got, want) {
		t.Fatalf("child ids=%v want=%v", got, want)
	}
	for _, hidden := range []int{3, 40, 170, 171, 172} {
		visible, err := isRelatedParentRowVisible(tx, rlsPilotTableName, hidden, "basic", 8, policy)
		if err != nil || visible {
			t.Fatalf("reference parent %d visible=%t err=%v", hidden, visible, err)
		}
		visible, err = RowsVisibleForRead(tx, rlsPilotTableName, "basic", 8, []int64{int64(hidden)})
		if err != nil || visible {
			t.Fatalf("exact reference %d visible=%t err=%v", hidden, visible, err)
		}
	}
}

func TestRLSPilotDisabledRLSKeepsVisibilityOnEveryReadPostgres(t *testing.T) {
	owner, reader := pilotProtectionPostgres(t)
	if _, err := owner.Exec("ALTER TABLE app_service_catalog DISABLE ROW LEVEL SECURITY"); err != nil {
		t.Fatal(err)
	}
	tx := pilotReadTx(t, reader, 8)
	assertPilotProtection(t, tx, 8, false)
	assertPilotReadSurfaces(t, tx, []int{1, 169})
}

func TestRLSPilotMissingPolicyKeepsVisibilityOnEveryReadPostgres(t *testing.T) {
	owner, _ := pilotProtectionPostgres(t)
	for _, expected := range pilotExpectedPolicies {
		t.Run(expected.name, func(t *testing.T) {
			ddl, err := owner.Begin()
			if err != nil {
				t.Fatal(err)
			}
			defer ddl.Rollback()
			if _, err := ddl.Exec("DROP POLICY " + pq.QuoteIdentifier(expected.name) + " ON app_service_catalog"); err != nil {
				t.Fatal(err)
			}
			// See the pending DDL as the actual nonprivileged reading role.
			if _, err := ddl.Exec("SET LOCAL ROLE " + ownerResolverReaderRole); err != nil {
				t.Fatal(err)
			}
			if err := dbutils.ApplyRequestActorToTx(ddl, dbutils.NewRequestActorContext(8, "basic")); err != nil {
				t.Fatal(err)
			}
			assertPilotProtection(t, ddl, 8, false)
			want := []int{1, 169}
			if expected.command == "r" {
				want = []int{} // RLS without a SELECT policy refuses every row.
			}
			assertPilotReadSurfaces(t, ddl, want)
		})
	}
}

func TestRLSPilotWrongPolicyKeepsVisibilityOnEveryReadPostgres(t *testing.T) {
	owner, _ := pilotProtectionPostgres(t)
	for _, expected := range pilotExpectedPolicies {
		t.Run(expected.name, func(t *testing.T) {
			tx, err := owner.Begin()
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback()
			clause := " USING (true)"
			if expected.command == "a" {
				clause = " WITH CHECK (true)"
			}
			if _, err := tx.Exec("ALTER POLICY " + pq.QuoteIdentifier(expected.name) + " ON app_service_catalog" + clause); err != nil {
				t.Fatal(err)
			}
			if _, err := tx.Exec("SET LOCAL ROLE " + ownerResolverReaderRole); err != nil {
				t.Fatal(err)
			}
			if err := dbutils.ApplyRequestActorToTx(tx, dbutils.NewRequestActorContext(8, "basic")); err != nil {
				t.Fatal(err)
			}
			assertPilotProtection(t, tx, 8, false)
			assertPilotReadSurfaces(t, tx, []int{1, 169})
		})
	}
}

func TestRLSPilotExtraPermissivePolicyKeepsVisibilityOnEveryReadPostgres(t *testing.T) {
	owner, reader := pilotProtectionPostgres(t)
	if _, err := owner.Exec("CREATE POLICY unexpected_read ON app_service_catalog FOR SELECT USING (true)"); err != nil {
		t.Fatal(err)
	}
	tx := pilotReadTx(t, reader, 8)
	assertPilotProtection(t, tx, 8, false)
	assertPilotReadSurfaces(t, tx, []int{1, 169})
}

func TestRLSPilotBypassRLSRoleKeepsVisibilityOnEveryReadPostgres(t *testing.T) {
	owner, reader := pilotProtectionPostgres(t)
	if _, err := owner.Exec("ALTER ROLE " + ownerResolverReaderRole + " BYPASSRLS"); err != nil {
		t.Fatal(err)
	}
	tx := pilotReadTx(t, reader, 8)
	assertPilotProtection(t, tx, 8, false)
	assertPilotReadSurfaces(t, tx, []int{1, 169})
}

func TestRLSPilotSuperuserKeepsVisibilityOnEveryReadPostgres(t *testing.T) {
	owner, _ := pilotProtectionPostgres(t)
	tx := pilotReadTx(t, owner, 8)
	assertPilotProtection(t, tx, 8, false)
	assertPilotReadSurfaces(t, tx, []int{1, 169})
}

func TestRLSPilotUnforcedOwnerKeepsVisibilityOnEveryReadPostgres(t *testing.T) {
	owner, reader := pilotProtectionPostgres(t)
	if _, err := owner.Exec("GRANT CREATE ON SCHEMA public TO " + ownerResolverReaderRole + "; ALTER TABLE app_service_catalog OWNER TO " + ownerResolverReaderRole); err != nil {
		t.Fatal(err)
	}
	tx := pilotReadTx(t, reader, 8)
	assertPilotProtection(t, tx, 8, false)
	assertPilotReadSurfaces(t, tx, []int{1, 169})
}

func TestRLSPilotInheritedOwnerKeepsVisibilityOnEveryReadPostgres(t *testing.T) {
	owner, reader := pilotProtectionPostgres(t)
	if _, err := owner.Exec("CREATE ROLE wl33_table_owner; GRANT CREATE ON SCHEMA public TO wl33_table_owner; GRANT wl33_table_owner TO " + ownerResolverReaderRole + "; ALTER TABLE app_service_catalog OWNER TO wl33_table_owner"); err != nil {
		t.Fatal(err)
	}
	tx := pilotReadTx(t, reader, 8)
	assertPilotProtection(t, tx, 8, false)
	assertPilotReadSurfaces(t, tx, []int{1, 169})
}

func TestRLSPilotVerifiedProtectionMaySkipFlagsPostgres(t *testing.T) {
	_, reader := pilotProtectionPostgres(t)
	tx := pilotReadTx(t, reader, 8)
	assertPilotProtection(t, tx, 8, true)
	assertPilotReadSurfaces(t, tx, []int{1, 169})
	assertPilotProtection(t, tx, 4, false) // Settings must describe the actual SQL actor.
	if err := dbutils.ApplyRequestActorToTx(tx, dbutils.NewRequestActorContext(4, "basic")); err != nil {
		t.Fatal(err)
	}
	assertPilotProtection(t, tx, 4, true)
	policy, err := getLegacyMustTrueReadPolicy(tx, rlsPilotTableName)
	if err != nil {
		t.Fatal(err)
	}
	count, err := getRowCountWithReadPolicy(tx, rlsPilotTableName, "basic", 4, policy)
	if err != nil || count != 3 {
		t.Fatalf("owner count=%d err=%v, want own unpublished row included", count, err)
	}
}

func TestRLSPilotForcedOwnerMaySkipFlagsPostgres(t *testing.T) {
	owner, reader := pilotProtectionPostgres(t)
	if _, err := owner.Exec("GRANT CREATE ON SCHEMA public TO " + ownerResolverReaderRole + "; ALTER TABLE app_service_catalog OWNER TO " + ownerResolverReaderRole + "; ALTER TABLE app_service_catalog FORCE ROW LEVEL SECURITY"); err != nil {
		t.Fatal(err)
	}
	tx := pilotReadTx(t, reader, 8)
	assertPilotProtection(t, tx, 8, true)
	assertPilotReadSurfaces(t, tx, []int{1, 169})
}

func TestRLSPilotVerificationExpiresBetweenStatementsPostgres(t *testing.T) {
	owner, reader := pilotProtectionPostgres(t)
	tx := pilotReadTx(t, reader, 8)
	assertPilotProtection(t, tx, 8, true)
	// ALTER ROLE has no relation lock to wait for. A request/TTL cache would
	// wrongly trust its prior role evidence after this committed change.
	if _, err := owner.Exec("ALTER ROLE " + ownerResolverReaderRole + " BYPASSRLS"); err != nil {
		t.Fatal(err)
	}
	assertPilotProtection(t, tx, 8, false)
	assertPilotReadSurfaces(t, tx, []int{1, 169})
}

func TestRLSPilotGuestAndMissingActorSettingsPostgres(t *testing.T) {
	_, reader := pilotProtectionPostgres(t)
	tx := pilotReadTx(t, reader, 1)
	assertPilotProtection(t, tx, 1, true)
	policy, err := getLegacyMustTrueReadPolicy(tx, rlsPilotTableName)
	if err != nil {
		t.Fatal(err)
	}
	condition, args := buildReadRowPolicyCondition(rlsPilotTableName, "guest", 1, policy, 1)
	if got := rowGroupQueryIDs(t, tx, "SELECT id FROM app_service_catalog WHERE "+condition, args); !reflect.DeepEqual(got, []int{1, 169}) {
		t.Fatalf("guest ids=%v", got)
	}
	if _, err := tx.Exec("SELECT set_config('app.user_id', '', true), set_config('app.is_admin', '', true)"); err != nil {
		t.Fatal(err)
	}
	assertPilotProtection(t, tx, 1, false)
	if got := rowGroupQueryIDs(t, tx, "SELECT id FROM app_service_catalog WHERE "+condition, args); !reflect.DeepEqual(got, []int{1, 169}) {
		t.Fatalf("missing actor ids=%v", got)
	}
}

func TestRLSPilotVerificationRunsOncePerStatementPostgres(t *testing.T) {
	_, reader := pilotProtectionPostgres(t)
	tx := pilotReadTx(t, reader, 8)
	policy, err := getLegacyMustTrueReadPolicy(tx, rlsPilotTableName)
	if err != nil {
		t.Fatal(err)
	}
	condition, args := buildReadRowPolicyCondition(rlsPilotTableName, "basic", 8, policy, 1)
	var raw []byte
	if err := tx.QueryRow("EXPLAIN (ANALYZE, FORMAT JSON) SELECT id FROM app_service_catalog WHERE "+condition, args...).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	var plans []map[string]interface{}
	if err := json.Unmarshal(raw, &plans); err != nil {
		t.Fatal(err)
	}
	found := false
	var inspect func(map[string]interface{})
	inspect = func(node map[string]interface{}) {
		if node["Parent Relationship"] == "InitPlan" && strings.Contains(fmt.Sprint(node["Subplan Name"]), "InitPlan") {
			found = true
			if node["Actual Loops"] != float64(1) {
				t.Fatalf("verification loops=%v, want one", node["Actual Loops"])
			}
		}
		if children, ok := node["Plans"].([]interface{}); ok {
			for _, child := range children {
				inspect(child.(map[string]interface{}))
			}
		}
	}
	inspect(plans[0]["Plan"].(map[string]interface{}))
	if !found {
		t.Fatalf("verification was not an InitPlan: %s", raw)
	}
}
