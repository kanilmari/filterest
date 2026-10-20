// upgrade_postgres_test.go
// Proves K388 reports and approval against the actual three bundle migrations.
// Connects synthetic legacy settings, limited SELECT readers and exact target diffs.
// Starts and removes its own Unix-socket-only cluster, never an installation database.
package articlecomparison

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	read "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read"
	_ "github.com/lib/pq"
)

func TestArticlePresentationUpgradePostgres(t *testing.T) {
	owner, reader := upgradeDatabase(t)
	fixture, err := os.ReadFile("../../../../testing/fixtures/article_bundle_legacy.sql")
	if err != nil {
		t.Fatal(err)
	}
	upgradeExec(t, owner, string(fixture))
	// These are legacy metadata columns used by normal projection readers, omitted
	// by the storage-only fixture. No application rows are needed for this proof.
	upgradeExec(t, owner, `ALTER TABLE public.system_column_details
 ADD COLUMN hide_on_small_card boolean, ADD COLUMN hide_on_bg_crd_if_not_own boolean,
 ADD COLUMN hide_false_null_on_big_crd boolean;
 CREATE TABLE public.article_fixture(title text,body text,image text);
 CREATE TABLE public.metadata_fixture(name text,notes text);
 CREATE ROLE presentation_reader LOGIN NOSUPERUSER;
 GRANT USAGE ON SCHEMA public TO presentation_reader;
 GRANT SELECT ON ALL TABLES IN SCHEMA public TO presentation_reader;`)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	before, err := read.ReadArticlePresentationBaseline(ctx, reader)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = read.ReadArticlePresentationAfter(ctx, reader); !errors.Is(err, read.ErrArticleAfterIncomplete) {
		t.Fatal("AFTER accepted legacy database", err)
	}
	for _, name := range []string{"20261015000010_add_article_bundle_storage.sql", "20261015000011_add_article_bundle_mutations.sql", "20261015000012_materialize_article_bundles.sql"} {
		migration, err := os.ReadFile(filepath.Join("../../../../server_tools/migrations", name))
		if err != nil {
			t.Fatal(err)
		}
		tx, err := owner.Begin()
		if err != nil {
			t.Fatal(err)
		}
		if _, err = tx.Exec(string(migration)); err != nil {
			tx.Rollback()
			t.Fatal(name, err)
		}
		if err = tx.Commit(); err != nil {
			t.Fatal(name, err)
		}
	}
	after, err := read.ReadArticlePresentationAfter(ctx, reader)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = read.ReadArticlePresentationBaseline(ctx, reader); !errors.Is(err, read.ErrArticleBaselineUpgraded) {
		t.Fatal("BEFORE accepted upgraded database", err)
	}
	// Round-trip the real wire format through the strict offline decoder.
	wire := func(r Report, phase string) Report {
		t.Helper()
		var b bytes.Buffer
		if err := read.WriteArticlePresentationBaseline(&b, r); err != nil {
			t.Fatal(err)
		}
		result, err := ReadReport(&b, phase)
		if err != nil {
			t.Fatal(err)
		}
		return result
	}
	approved := mustCompare(t, wire(before, "before"), wire(after, "after"))
	if len(approved.Differences) != 36 || approved.Unchanged != 0 {
		t.Fatalf("unexpected difference inventory: %d changed, %d unchanged", len(approved.Differences), approved.Unchanged)
	}
	// Exact expected projection UID/nullable-width sequences for every target.
	// Article preserves each target; unassigned IFAV/Page use exact-target copies.
	expected := map[string][]int64{
		"metadata/article_view": {1, 2, 3}, "site/article_view": {3, 1}, "group8/article_view": {2, 1}, "group9/article_view": {1}, "personal42/article_view": {3, 1}, "personal1/article_view": {3, 1}, "personal73/article_view": {3, 1},
		"metadata/image_first_view": {1, 2, 3}, "site/image_first_view": {3, 1, 2}, "group8/image_first_view": {2, 1}, "group9/image_first_view": {1}, "personal42/image_first_view": {3, 1}, "personal1/image_first_view": {3, 1, 2}, "personal73/image_first_view": {3, 1, 2},
		"metadata/image_first_page_view": {1, 2, 3}, "site/image_first_page_view": {3, 1, 2}, "group8/image_first_page_view": {2, 1}, "group9/image_first_page_view": {1}, "personal42/image_first_page_view": {3, 1}, "personal1/image_first_page_view": {3, 1, 2}, "personal73/image_first_page_view": {3, 1, 2},
	}
	for _, dataset := range after.Datasets {
		for k, target := range targets(dataset) {
			for _, presentation := range []string{"article_view", "image_first_view", "image_first_page_view"} {
				key := k.kind
				if k.kind == "group" || k.kind == "personal" {
					key += fmt.Sprint(k.id)
				}
				key += "/" + presentation
				want := expected[key]
				if dataset.UID == 11 {
					want = []int64{4, 5}
				}
				got := []int64{}
				for _, field := range projection(target, presentation).Fields {
					got = append(got, *field.UID)
				}
				if !reflect.DeepEqual(got, want) {
					t.Fatalf("dataset %d %s: %v, want %v", dataset.UID, key, got, want)
				}
			}
		}
	}
	// Independent expected diffs cover all 36 surfaces; do not derive the
	// oracle through the comparison implementation under test.
	type expectedDifference struct {
		before, after, removed int
		order, width           bool
	}
	expectedDiffs := map[string]expectedDifference{
		"metadata/article_view": {3, 3, 0, false, false}, "site/article_view": {2, 2, 0, false, false},
		"group8/article_view": {2, 2, 0, false, false}, "group9/article_view": {1, 1, 0, false, false},
		"personal42/article_view": {2, 2, 0, false, false}, "personal1/article_view": {2, 2, 0, false, false}, "personal73/article_view": {2, 2, 0, false, false},
		"metadata/image_first_view": {3, 3, 0, false, false}, "site/image_first_view": {3, 3, 0, false, false},
		"group8/image_first_view": {3, 2, 1, true, true}, "group9/image_first_view": {3, 1, 2, false, true},
		"personal42/image_first_view": {3, 2, 1, false, true}, "personal1/image_first_view": {3, 3, 0, false, false}, "personal73/image_first_view": {3, 3, 0, false, false},
		"metadata/image_first_page_view": {3, 3, 0, false, false}, "site/image_first_page_view": {3, 3, 0, true, true},
		"group8/image_first_page_view": {3, 2, 1, true, true}, "group9/image_first_page_view": {3, 1, 2, false, true},
		"personal42/image_first_page_view": {3, 2, 1, true, true}, "personal1/image_first_page_view": {3, 3, 0, true, true}, "personal73/image_first_page_view": {3, 3, 0, true, true},
	}
	for _, d := range approved.Differences {
		if !d.Blocks || !d.Other || d.Audience {
			t.Fatalf("unexpected policy flags: %+v", d)
		}
		key := d.TargetKind
		if d.TargetID != nil {
			key += fmt.Sprint(*d.TargetID)
		}
		key += "/" + d.Presentation
		want, ok := expectedDiffs[key]
		if d.DatasetUID == 11 {
			want = expectedDifference{2, 2, 0, false, false}
			ok = true
		}
		if !ok || d.BeforeCount != want.before || d.AfterCount != want.after || d.Added != 0 || d.Removed != want.removed || d.Order != want.order || d.Widths != want.width {
			t.Fatalf("unexpected projection diff for %d %s: %+v, want %+v", d.DatasetUID, key, d, want)
		}
		if d.DatasetUID == 10 && key == "group8/image_first_view" {
			fields := targets(after.Datasets[0])[targetKey{"group", 8}].IFAV.ConfiguredProjection.Fields
			if fields[0].Width != 280 || fields[1].Width != 90 {
				t.Fatal("known IFAV widths not preserved")
			}
		}
	}
	again, err := read.ReadArticlePresentationAfter(ctx, reader)
	if err != nil {
		t.Fatal(err)
	}
	result, err := Check(mustCompare(t, before, again), approved)
	if err != nil || !result.Equal {
		t.Fatal("repeat AFTER did not match approval", result, err)
	}
	// A reader with only SELECT succeeds above; PostgreSQL also refuses a write
	// under the exact enforced transaction options used by both exporters.
	tx, err := owner.BeginTx(ctx, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	var mode, isolation string
	if err := tx.QueryRow(`SHOW transaction_read_only`).Scan(&mode); err != nil || mode != "on" {
		t.Fatal("snapshot not enforced read-only", mode, err)
	}
	if err := tx.QueryRow(`SHOW transaction_isolation`).Scan(&isolation); err != nil || isolation != "repeatable read" {
		t.Fatal("snapshot isolation", isolation, err)
	}
	if _, err = tx.Exec(`UPDATE public.system_users SET id=id`); err == nil {
		t.Fatal("read-only snapshot allowed persistent writes")
	}

}

func upgradeExec(t *testing.T, db *sql.DB, sql string) {
	t.Helper()
	if _, err := db.Exec(sql); err != nil {
		t.Fatal("disposable fixture", err)
	}
}
func upgradeDatabase(t *testing.T) (*sql.DB, *sql.DB) {
	t.Helper()
	if os.Getenv("FILTEREST_TEST_DISPOSABLE_POSTGRES") != "1" {
		t.Skip("set FILTEREST_TEST_DISPOSABLE_POSTGRES=1 for isolated upgrade proof")
	}
	bin := os.Getenv("PG_TEST_BIN")
	if bin == "" {
		bin = "/usr/lib/postgresql/16/bin"
	}
	root := t.TempDir()
	socket, data := filepath.Join(root, "socket"), filepath.Join(root, "db")
	if err := os.Mkdir(socket, 0700); err != nil {
		t.Fatal(err)
	}
	run := func(name string, args ...string) {
		t.Helper()
		if output, err := exec.Command(filepath.Join(bin, name), args...).CombinedOutput(); err != nil {
			log, _ := os.ReadFile(filepath.Join(root, "postgres.log"))
			t.Fatalf("disposable %s: %v: %s\n%s", name, err, output, log)
		}
	}
	run("initdb", "-D", data, "-A", "trust", "-U", "fixture_owner", "--no-locale", "--encoding=UTF8")
	t.Cleanup(func() {
		if _, err := os.Stat(filepath.Join(data, "postmaster.pid")); errors.Is(err, os.ErrNotExist) {
			return
		}
		if output, err := exec.Command(filepath.Join(bin, "pg_ctl"), "-D", data, "-m", "immediate", "-w", "stop").CombinedOutput(); err != nil {
			t.Errorf("stop disposable PostgreSQL: %v: %s", err, output)
		}
	})
	run("pg_ctl", "-D", data, "-l", filepath.Join(root, "postgres.log"), "-o", "-h '' -k '"+socket+"' -p 15489", "-w", "start")
	open := func(user string) *sql.DB {
		db, err := sql.Open("postgres", fmt.Sprintf("host=%s port=15489 user=%s dbname=postgres sslmode=disable", socket, user))
		if err != nil {
			t.Fatal(err)
		}
		db.SetMaxOpenConns(1)
		t.Cleanup(func() { db.Close() })
		return db
	}
	return open("fixture_owner"), open("presentation_reader")
}
