// legacy_trigger_review_postgres_test.go
// Verifies legacy pg_proc fingerprints, definer gating and own-row timestamp effects.
// Uses only the disposable PostgreSQL fixture, never the development database.
// Proves the reviewed bodies run without adding cross-table dependencies.
package runtime_grants

import (
	"context"
	"database/sql"
	"testing"

	"github.com/lib/pq"
)

func TestLegacyTriggerReviewPostgres(t *testing.T) {
	owner, _ := grantDisposableDB(t)
	fixtureExec(t, owner, `CREATE TABLE legacy_trigger_rows(id int PRIMARY KEY, title text, updated timestamptz, updated_at timestamptz);
 INSERT INTO legacy_trigger_rows VALUES(1,'old','2000-01-01 UTC','2000-01-01 UTC'),(2,'untouched','2000-01-01 UTC','2000-01-01 UTC')`)
	var sourceOID int64
	if err := owner.QueryRow(`SELECT 'legacy_trigger_rows'::regclass::oid`).Scan(&sourceOID); err != nil {
		t.Fatal(err)
	}
	for _, fixture := range legacyTriggerFixtures(t) {
		t.Run(fixture.name, func(t *testing.T) {
			fixtureExec(t, owner, fixture.definition)
			name := "public." + pq.QuoteIdentifier(fixture.name)
			fixtureExec(t, owner, "CREATE TRIGGER legacy_review BEFORE UPDATE ON legacy_trigger_rows FOR EACH ROW EXECUTE FUNCTION "+name+"()")
			t.Cleanup(func() {
				fixtureExec(t, owner, "DROP TRIGGER legacy_review ON legacy_trigger_rows; DROP FUNCTION "+name+"()")
				fixtureExec(t, owner, `UPDATE legacy_trigger_rows SET title=CASE id WHEN 1 THEN 'old' ELSE 'untouched' END, updated='2000-01-01 UTC', updated_at='2000-01-01 UTC'`)
			})
			var digest string
			var definer bool
			if err := owner.QueryRow(`SELECT md5(prosrc),prosecdef FROM pg_proc WHERE oid=to_regprocedure($1)`, name+"()").Scan(&digest, &definer); err != nil {
				t.Fatal(err)
			}
			if digest != fixture.digest || definer != fixture.definer {
				t.Fatal("PostgreSQL catalogue differs from reviewed source bytes", digest, definer)
			}
			check := func(blocked bool) {
				t.Helper()
				tx, err := owner.BeginTx(context.Background(), &sql.TxOptions{ReadOnly: true})
				if err != nil {
					t.Fatal(err)
				}
				defer tx.Rollback()
				s := GrantSnapshot{Objects: map[int64]Object{sourceOID: {OID: sourceOID, Schema: "public", Name: "legacy_trigger_rows", Kind: "table"}}}
				if err := readTriggerDependencies(context.Background(), tx, &s); err != nil || HasBlockers(s.Blockers) != blocked {
					t.Fatalf("catalogue trigger review: %v %+v", err, s.Blockers)
				}
			}
			check(!reviewedTriggerBodies[fixture.digest])
			if !reviewedTriggerBodies[fixture.digest] {
				return // cross-table and privilege writers are never invoked
			}
			fixtureExec(t, owner, `UPDATE legacy_trigger_rows SET title='new' WHERE id=1`)
			var updated, updatedAt, untouched bool
			if err := owner.QueryRow(`SELECT updated > '2000-01-01 UTC', updated_at > '2000-01-01 UTC' FROM legacy_trigger_rows WHERE id=1 AND title='new'`).Scan(&updated, &updatedAt); err != nil {
				t.Fatal(err)
			}
			if wantUpdatedAt := fixture.name == "set_transaction_log_updated_at_timestamp"; updated == wantUpdatedAt || updatedAt != wantUpdatedAt {
				t.Fatal("timestamp body changed the wrong column", updated, updatedAt)
			}
			if err := owner.QueryRow(`SELECT title='untouched' AND updated='2000-01-01 UTC' AND updated_at='2000-01-01 UTC' FROM legacy_trigger_rows WHERE id=2`).Scan(&untouched); err != nil || !untouched {
				t.Fatal("timestamp body changed another row", err)
			}
			fixtureExec(t, owner, "ALTER FUNCTION "+name+"() SECURITY DEFINER")
			check(true)
		})
	}
}
