// article_bundle_materialization_postgres_test.go
// Proves migration-only article checking, atomic refusal and restored runtime deferral.
// Connects upgrade and generated bootstrap transactions to real function statistics.
// Uses disposable clusters and test-only tracking; production functions stay unchanged.
package system_table_tools

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func articleMaterializationExec(t *testing.T, tx *sql.Tx, query string) {
	t.Helper()
	if _, err := tx.Exec(query); err != nil {
		t.Fatal(err)
	}
}

func articleMaterializationXactCalls(t *testing.T, tx *sql.Tx, want int) {
	t.Helper()
	var calls int
	if err := tx.QueryRow(`SELECT COALESCE((SELECT calls FROM pg_stat_xact_user_functions
	 WHERE funcid='public.app_check_article_bundles()'::regprocedure),0)`).Scan(&calls); err != nil {
		t.Fatal(err)
	}
	if calls != want {
		t.Fatalf("full checker calls in transaction: got %d, want %d", calls, want)
	}
}

func articleMaterializationSessionCalls(t *testing.T, conn *sql.Conn) int {
	t.Helper()
	ctx := context.Background()
	// Publish this backend's counters at command end, including commit events.
	if _, err := conn.ExecContext(ctx, `SELECT pg_stat_force_next_flush()`); err != nil {
		t.Fatal(err)
	}
	var calls int
	if err := conn.QueryRowContext(ctx, `SELECT COALESCE((SELECT calls FROM pg_stat_user_functions
	 WHERE funcid='public.app_check_article_bundles()'::regprocedure),0)`).Scan(&calls); err != nil {
		t.Fatal(err)
	}
	return calls
}

func TestArticleBundleMaterializationChecksOncePostgres(t *testing.T) {
	for _, fresh := range []bool{false, true} {
		name := "upgrade"
		if fresh {
			name = "fresh bootstrap"
		}
		t.Run(name, func(t *testing.T) {
			data := articleBundleSQL(t, articleBundleMigrations[2])
			var db *sql.DB
			// Include pending pre-marker events, as a whole-seed bootstrap does.
			prefix, suffix := `UPDATE system_db_tables SET table_name=table_name;`, ""
			if fresh {
				db = sitePresentationDisposableDB(t)
				frontPageExec(t, db, `DROP TABLE public.system_config`)
				root := filepath.Join("..", "..", "..", "server_tools", "public_bootstrap")
				read := func(name string) string {
					t.Helper()
					raw, err := os.ReadFile(filepath.Join(root, name))
					if err != nil {
						t.Fatal(err)
					}
					return string(raw)
				}
				articleBundleTransaction(t, db, read("schema.sql"))
				var found bool
				prefix, suffix, found = strings.Cut(read("seed_data.sql"), data)
				if !found {
					t.Fatal("bootstrap must embed the exact materialization migration")
				}
			} else {
				db = articleBundleFixture(t, false)
			}
			ctx := context.Background()
			conn, err := db.Conn(ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer conn.Close()
			// Only the disposable test owner's session enables tracking. The SQL
			// checker's SET clause prevents inlining, so calls count its real body.
			if _, err := conn.ExecContext(ctx, `SET track_functions='all'; SET stats_fetch_consistency='none'`); err != nil {
				t.Fatal(err)
			}
			before := articleMaterializationSessionCalls(t, conn)
			tx, err := conn.BeginTx(ctx, nil)
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback()
			articleMaterializationExec(t, tx, prefix)
			articleMaterializationXactCalls(t, tx, 0)
			articleMaterializationExec(t, tx, data)
			articleMaterializationXactCalls(t, tx, 1)
			// Deferral must already be restored inside the migration transaction.
			// Roll back the probe so it cannot add a check or an invalid result.
			articleMaterializationExec(t, tx, `SAVEPOINT runtime_probe;
			 UPDATE system_db_tables SET article_section_initial_open='{}'
			 WHERE table_uid=(SELECT min(table_uid) FROM system_db_tables);
			 ROLLBACK TO SAVEPOINT runtime_probe; RELEASE SAVEPOINT runtime_probe;`)
			// If a covered event survived the marker, draining it now would call
			// the checker again. None may be silently discarded at this boundary.
			articleMaterializationExec(t, tx, `SET CONSTRAINTS public.article_bundle_invariant IMMEDIATE;
			 SET CONSTRAINTS public.article_bundle_invariant DEFERRED;`)
			articleMaterializationXactCalls(t, tx, 1)
			want := 1
			if fresh {
				// Finish the real seed in this same transaction. Its package-wide
				// acceptance block independently checks the complete bootstrap once.
				articleMaterializationExec(t, tx, suffix)
				want++
			}
			articleMaterializationXactCalls(t, tx, want)
			if err := tx.Commit(); err != nil {
				t.Fatal(err)
			}
			if calls := articleMaterializationSessionCalls(t, conn) - before; calls != want {
				t.Fatalf("checker calls including commit: got %d, want %d", calls, want)
			}
			// Following transactions on this exact session start DEFERRED and
			// reject violations at commit, including both round-1 cache attacks.
			for _, attack := range []string{
				"",
				`RESET ALL;`,
				`SET LOCAL filterest.article_bundle_checked_generation='forged';
				 SET LOCAL filterest.article_bundle_write_generation='forged';`,
			} {
				tx, err := conn.BeginTx(ctx, nil)
				if err != nil {
					t.Fatal(err)
				}
				defer tx.Rollback()
				query := `UPDATE system_db_tables SET article_section_initial_open='{}'
				 WHERE table_uid=(SELECT min(table_uid) FROM system_db_tables);`
				if attack != "" {
					query = `UPDATE system_db_tables SET table_name=table_name;
					 SET CONSTRAINTS public.article_bundle_invariant IMMEDIATE;
					 SET CONSTRAINTS public.article_bundle_invariant DEFERRED;` + query + attack
				}
				articleMaterializationExec(t, tx, query)
				if err := tx.Commit(); err == nil || !strings.Contains(err.Error(), "article bundle invariant:") {
					t.Fatal("violating runtime write must succeed initially and fail at commit", attack, err)
				}
			}
		})
	}
}

func articleMaterializationRows(t *testing.T, db *sql.DB) string {
	t.Helper()
	// Include every persistent table written by migration 12, with stable row
	// ordering. Sequence allocations are PostgreSQL's nontransactional counters.
	var pairs []string
	for _, table := range []string{
		"system_table_views", "system_functions", "system_lang_keys", "system_lang_key_translations",
		"system_column_details", "system_column_field_sets", "system_column_field_set_members",
		"system_view_field_set_assignments", "system_db_tables", "system_group_table_func_rights",
		"system_data_repair_records",
	} {
		pairs = append(pairs, "'"+table+"', (SELECT jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text) FROM public."+table+" r)")
	}
	return articleBundleText(t, db, "SELECT jsonb_build_object("+strings.Join(pairs, ",")+")::text")
}

func TestArticleBundleMaterializationFinalCheckAtomicPostgres(t *testing.T) {
	db := articleBundleFixture(t, false)
	// Well-shaped presentation JSON on a legacy collection passes its CHECK,
	// but violates the full invariant. Materialization preserves that collection
	// for its Table assignment, so only the explicit final check can refuse it.
	frontPageExec(t, db, `UPDATE system_column_field_set_members
	 SET presentation_values=app_article_values(true) WHERE field_set_id=100 AND column_uid=3`)
	before := articleMaterializationRows(t, db)
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	_, err = tx.Exec(articleBundleSQL(t, articleBundleMigrations[2]))
	if err == nil || !strings.Contains(err.Error(), "article materialization refused: article member has invalid values, legacy width or forbidden field") {
		t.Fatal("seeded violation must reach and fail the explicit final check", err)
	}
	if err := tx.Commit(); err == nil {
		t.Fatal("refused migration transaction must not commit")
	}
	if after := articleMaterializationRows(t, db); after != before {
		t.Fatal("refused migration committed persistent row changes")
	}
	if got := frontPageCount(t, db, `SELECT count(*) FROM system_column_field_sets WHERE article_family`); got != 0 {
		t.Fatal("failed migration left materialized bundles", got)
	}
	if got := frontPageCount(t, db, `SELECT count(*) FROM system_data_repair_records WHERE migration='article_bundle_materialization'`); got != 0 {
		t.Fatal("failed migration left a completion marker", got)
	}
}
