// sql_path_reader_postgres_test.go
// Verifies reviewed definer catalogue settings in an isolated PostgreSQL cluster.
// Uses the shared audit fixture and exact newest migration definitions.
// Keeps SQL-path security proofs separate from general ACL comparison tests.
package runtime_grants

import (
	"context"
	"database/sql"
	"os"
	"strings"
	"testing"

	"github.com/lib/pq"
)

func TestReviewedDefinerFunctionsPostgres(t *testing.T) {
	owner, connect := grantDisposableDB(t)
	config := RoleConfiguration{Names: map[string]string{"basic": "reviewed basic", "guest": "reviewed guest", "readonly": "reviewed readonly", "confidential": "reviewed confidential"}, ProtectedNames: []string{"fixture_owner"}}
	for _, name := range config.Names {
		fixtureExec(t, owner, "CREATE ROLE "+pq.QuoteIdentifier(name)+" LOGIN")
	}
	const auditRole = "reviewed independent audit"
	fixtureExec(t, owner, "CREATE ROLE "+pq.QuoteIdentifier(auditRole)+" LOGIN")
	fixtureExec(t, owner, `REVOKE CREATE ON SCHEMA public FROM PUBLIC`)
	fixture, err := os.ReadFile("testdata/grant_catalogue.sql")
	if err != nil {
		t.Fatal(err)
	}
	fixtureExec(t, owner, string(fixture))
	fixtureExec(t, owner, `CREATE TABLE system_row_access_rules(table_uid bigint,row_id bigint,action_id bigint,effect text,valid_from timestamptz,valid_until timestamptz,user_id bigint,group_id bigint);
 CREATE TABLE system_permission_actions(id bigint,enabled boolean,scope_type text,action_key text);
 CREATE SCHEMA unreviewed_definer`)
	fixtureExec(t, owner, "GRANT SELECT ON ALL TABLES IN SCHEMA public TO "+pq.QuoteIdentifier(auditRole))
	auditor := connect(auditRole)
	const reviewedDigest = "8c5a769a59dfaa06a4c1ce947ff562b9"
	identity, ok := reviewedDefinerBodies[reviewedDigest]
	if !ok {
		t.Fatal("row-access resolver is absent from the reviewed list")
	}
	definition, body, _ := newestDefinerMigrationFunction(t, identity)
	nameCopy, schemaCopy, argumentCopy := identity, identity, identity
	nameCopy.Name = "unreviewed_row_access_copy"
	schemaCopy.Schema = "unreviewed_definer"
	argumentCopy.ArgumentTypes = "text, integer, bigint, text, boolean, boolean"
	for _, test := range []struct {
		name               string
		definition         string
		identity           definerFunctionIdentity
		reviewed           bool
		skipBodyValidation bool
	}{
		{"exact migration", definition, identity, true, false},
		{"immutable", strings.Replace(definition, "\nSTABLE\n", "\nIMMUTABLE\n", 1), identity, true, false},
		{"volatile", strings.Replace(definition, "\nSTABLE\n", "\nVOLATILE\n", 1), identity, false, false},
		{"body changed one character", strings.Replace(definition, body, body+" ", 1), identity, false, false},
		{"plpgsql same body", strings.Replace(definition, "LANGUAGE sql", "LANGUAGE plpgsql", 1), identity, false, true},
		{"no search path", strings.Replace(definition, "SET search_path = pg_catalog, public\n", "", 1), identity, false, false},
		{"unreviewed name", strings.Replace(definition, identity.Schema+"."+identity.Name, nameCopy.Schema+"."+nameCopy.Name, 1), nameCopy, false, false},
		{"unreviewed schema", strings.Replace(definition, identity.Schema+"."+identity.Name, schemaCopy.Schema+"."+schemaCopy.Name, 1), schemaCopy, false, false},
		{"unreviewed arguments", strings.Replace(definition, "target_row_id BIGINT", "target_row_id INTEGER", 1), argumentCopy, false, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			tx, err := owner.BeginTx(context.Background(), nil)
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback()
			if test.skipBodyValidation {
				// Preserve the reviewed SQL bytes under another language to isolate
				// the language gate. This deliberately invalid copy is never called.
				if _, err := tx.Exec(`SET LOCAL check_function_bodies = off`); err != nil {
					t.Fatal(err)
				}
			}
			if _, err := tx.Exec(test.definition); err != nil {
				t.Fatal(err)
			}
			if err := tx.Commit(); err != nil {
				t.Fatal(err)
			}
			qualifiedName := pq.QuoteIdentifier(test.identity.Schema) + "." + pq.QuoteIdentifier(test.identity.Name)
			signature := qualifiedName + "(" + test.identity.ArgumentTypes + ")"
			t.Cleanup(func() { fixtureExec(t, owner, "DROP FUNCTION "+signature) })
			var oid int64
			var digest string
			var publicExecute bool
			if err := owner.QueryRow(`SELECT p.oid,md5(p.prosrc),EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') FROM pg_proc p WHERE p.oid=to_regprocedure($1)`, signature).Scan(&oid, &digest, &publicExecute); err != nil {
				t.Fatal(err)
			}
			if !publicExecute {
				t.Fatal("default PUBLIC EXECUTE is missing")
			}
			if (digest == reviewedDigest) != (test.name != "body changed one character") {
				t.Fatal("fixture did not preserve the intended body fingerprint")
			}
			for _, name := range append([]string{auditRole}, config.Names["basic"], config.Names["guest"], config.Names["readonly"], config.Names["confidential"]) {
				var executable bool
				if err := owner.QueryRow(`SELECT has_function_privilege($1,$2::oid,'EXECUTE')`, name, oid).Scan(&executable); err != nil || !executable {
					t.Fatalf("PUBLIC execution did not reach the test identity: %v", err)
				}
			}
			result, err := AuditRuntimeGrants(context.Background(), auditor, config)
			if test.reviewed {
				if err != nil || HasBlockers(result) {
					t.Fatalf("reviewed definer blocked the audit: %v, %v", err, result)
				}
				var allowed bool
				if err := auditor.QueryRow(`SELECT public.resolve_effective_row_access('fresh_source',1,1,'read',true,false)`).Scan(&allowed); err != nil || !allowed {
					t.Fatalf("reviewed resolver could not execute: %v", err)
				}
			} else if err == nil || err.Error() != "audit identity may write or assume an elevated identity" {
				t.Fatalf("unreviewed definer did not refuse the audit identity: %v", err)
			}
			reviewTx, err := owner.BeginTx(context.Background(), &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
			if err != nil {
				t.Fatal(err)
			}
			defer reviewTx.Rollback()
			snapshot, err := LoadGrantSnapshot(context.Background(), reviewTx, config)
			if err != nil {
				t.Fatal(err)
			}
			var paths []Finding
			if err := readSQLPathBlockers(context.Background(), reviewTx, snapshot, &paths); err != nil {
				t.Fatal(err)
			}
			for _, findings := range [][]Finding{snapshot.Blockers, paths} {
				if test.reviewed && HasBlockers(findings) {
					t.Fatal("reviewed definer appeared as an owner-run SQL blocker", findings)
				}
				for _, role := range snapshot.Roles {
					if hasFinding(findings, role.Label, "blocker", "function", oid) == test.reviewed {
						t.Fatalf("owner-run review disagreed for %s: %v", role.Label, findings)
					}
				}
			}
		})
	}
}
