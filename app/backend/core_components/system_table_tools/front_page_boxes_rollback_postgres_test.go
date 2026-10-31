// front_page_boxes_rollback_postgres_test.go
// Rehearses the saved Home boxes downgrade from a real pre-migration backup.
// Connects the historical 9.12.0 bootstrap, new writer and PostgreSQL recovery tools.
// Restores into a fresh disposable database; never touches an installation's state.
package system_table_tools

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/lib/pq"
)

func TestFrontPageBoxesRollbackRehearsalPostgres(t *testing.T) {
	// Reuse the batch's socket-only cluster, but build the source in a separate,
	// empty database. The cluster's current-bootstrap database is only a host.
	host := frontPageDisposableDB(t)
	var socket, port string
	if err := host.QueryRow(`SELECT current_setting('unix_socket_directories'),current_setting('port')`).Scan(&socket, &port); err != nil {
		t.Fatal(err)
	}
	bin := os.Getenv("PG_TEST_BIN")
	if bin == "" {
		bin = "/usr/lib/postgresql/16/bin"
	}
	run := func(tool string, args ...string) {
		t.Helper()
		args = append([]string{"--host=" + socket, "--port=" + port, "--username=fixture_owner", "--no-password"}, args...)
		if out, err := exec.Command(filepath.Join(bin, tool), args...).CombinedOutput(); err != nil {
			t.Fatalf("%s: %v: %s", tool, err, out)
		}
	}
	freshDB := func(name string) *sql.DB {
		t.Helper()
		frontPageExec(t, host, `CREATE DATABASE `+pq.QuoteIdentifier(name)+` TEMPLATE template0`)
		// Register disposal before opening/importing: failed setup or restore must
		// also drop its database, before the owning fixture stops the cluster.
		t.Cleanup(func() {
			if _, err := host.Exec(`DROP DATABASE ` + pq.QuoteIdentifier(name) + ` WITH (FORCE)`); err != nil {
				t.Errorf("drop rollback database %s: %v", name, err)
			}
			var remaining int
			if err := host.QueryRow(`SELECT count(*) FROM pg_database WHERE datname=$1`, name).Scan(&remaining); err != nil || remaining != 0 {
				t.Errorf("rollback database %s still present: count=%d, error=%v", name, remaining, err)
			}
		})
		db, err := sql.Open("postgres", fmt.Sprintf("host=%s port=%s user=fixture_owner dbname=%s sslmode=disable", socket, port, name))
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() {
			if err := db.Close(); err != nil {
				t.Errorf("close rollback database %s: %v", name, err)
			}
		})
		return db
	}
	value := func(db *sql.DB, query string) string {
		t.Helper()
		var result string
		if err := db.QueryRow(query).Scan(&result); err != nil {
			t.Fatal(err)
		}
		return result
	}
	assert912 := func(db *sql.DB) {
		t.Helper()
		if got := value(db, `SELECT version FROM public.system_db_version ORDER BY id DESC LIMIT 1`); got != "9.12.0" {
			t.Fatalf("newest database release = %s, want 9.12.0", got)
		}
		if frontPageCount(t, db, `SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND
			((table_name='system_front_page_blocks' AND column_name IN ('title','query','category_links')) OR
			 (table_name='system_front_page_revisions' AND column_name='is_custom'))`) != 0 {
			t.Fatal("9.13.1 columns present in 9.12.0 database")
		}
		if frontPageCount(t, db, `SELECT count(*) FROM pg_constraint WHERE conrelid='public.system_front_page_blocks'::regclass
			AND conname='uq_system_front_page_blocks_dataset' AND contype='u'`) != 1 {
			t.Fatal("9.12.0 dataset uniqueness missing")
		}
		if frontPageCount(t, db, `SELECT count(*) FROM public.system_db_version WHERE version='9.13.1'`) != 0 ||
			frontPageCount(t, db, `SELECT count(*) FROM public.system_data_repair_records WHERE migration='saved_home_boxes'`) != 0 {
			t.Fatal("9.13.1 release or migration marker present in 9.12.0 database")
		}
	}

	source := freshDB("home_boxes_912_source")
	// This is the actual pre-batch package, following the historical-bootstrap
	// fixture in dataset_appearance_migration_postgres_test.go. Do not manufacture
	// an old database by dropping columns from today's 9.13.1 bootstrap.
	const beforeBatch = "090618e07d39de98c309ac99f5aee17067b6a125"
	for _, name := range []string{"schema.sql", "seed_data.sql"} {
		raw, err := exec.Command("git", "show", beforeBatch+":app/server_tools/public_bootstrap/"+name).Output()
		if err != nil {
			t.Fatalf("read historical 9.12.0 %s: %v", name, err)
		}
		frontPageExec(t, source, string(raw))
	}
	assert912(source)
	// Bootstrap acceptance records every folded-in migration. Require the exact
	// complete baseline through the 9.12.0 owner, and no later migration at all.
	const last912 = "20261015000099_record_database_release_9_12_0.sql"
	migrations, err := os.ReadDir(filepath.Join("..", "..", "..", "server_tools", "migrations"))
	if err != nil {
		t.Fatal(err)
	}
	expected := []string{}
	for _, migration := range migrations {
		if !migration.IsDir() && strings.HasSuffix(migration.Name(), ".sql") && migration.Name() <= last912 {
			expected = append(expected, migration.Name())
		}
	}
	var baseline []string
	if err := json.Unmarshal([]byte(value(source, `SELECT jsonb_agg(filename ORDER BY filename)::text FROM public.system_schema_migrations`)), &baseline); err != nil {
		t.Fatal(err)
	}
	if len(expected) == 0 || expected[len(expected)-1] != last912 || !reflect.DeepEqual(baseline, expected) {
		t.Fatalf("9.12.0 migration baseline mismatch: got %v, want %v", baseline, expected)
	}
	frontPageExec(t, source, `INSERT INTO public.system_users(id,username,enabled) VALUES(42,'Rollback rehearsal reader',true);
		INSERT INTO public.system_front_page_blocks(user_id,table_uid,result_limit,sort_order,enabled)
		SELECT fixture.user_id,registry.table_uid,fixture.result_limit,fixture.position,fixture.enabled
		FROM (VALUES (NULL::bigint,'tiketit',1,2,true), (NULL::bigint,'palvelukatalogi',20,7,false),
			(42,'tiketit',9,4,false)) AS fixture(user_id,dataset,result_limit,position,enabled)
		JOIN public.system_db_tables registry ON registry.table_name=fixture.dataset;
		INSERT INTO public.system_front_page_revisions(user_id,revision)
		SELECT user_id,max(updated) FROM public.system_front_page_blocks GROUP BY user_id`)
	if frontPageCount(t, source, `SELECT count(*) FROM public.system_front_page_blocks WHERE user_id IS NULL`) != 2 ||
		frontPageCount(t, source, `SELECT count(*) FROM public.system_front_page_blocks WHERE user_id=42`) != 1 {
		t.Fatal("legacy fixture must contain two common boxes and one personal box")
	}
	const legacyRows = `SELECT jsonb_agg(to_jsonb(box)-ARRAY['title','query','category_links'] ORDER BY id)::text
		FROM public.system_front_page_blocks box`
	beforeRows := value(source, legacyRows)
	// Capture defaults, types, nullability, exact constraint definitions, all
	// legacy values/timestamps, scope revisions, metadata and release/ledger rows.
	const snapshot = `SELECT jsonb_build_object(
		'columns',(SELECT jsonb_agg(jsonb_build_array(c.relname,a.attname,format_type(a.atttypid,a.atttypmod),
			a.attnotnull,pg_get_expr(d.adbin,d.adrelid)) ORDER BY c.relname,a.attnum)
			FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
			LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
			WHERE a.attrelid IN ('public.system_front_page_blocks'::regclass,'public.system_front_page_revisions'::regclass)
			AND a.attnum>0 AND NOT a.attisdropped),
		'constraints',(SELECT jsonb_agg(jsonb_build_array(conrelid::regclass::text,conname,pg_get_constraintdef(oid),
			condeferrable,condeferred,convalidated) ORDER BY conrelid::regclass::text,conname)
			FROM pg_constraint WHERE conrelid IN ('public.system_front_page_blocks'::regclass,'public.system_front_page_revisions'::regclass)),
		'boxes',(SELECT jsonb_agg(to_jsonb(b) ORDER BY id) FROM public.system_front_page_blocks b),
		'revisions',(SELECT jsonb_agg(to_jsonb(r) ORDER BY user_id NULLS FIRST) FROM public.system_front_page_revisions r),
		'column_metadata',(SELECT jsonb_agg(to_jsonb(m) ORDER BY column_uid) FROM public.system_column_details m
			WHERE table_uid=(SELECT table_uid FROM public.system_db_tables WHERE table_name='system_front_page_blocks')),
		'releases',(SELECT jsonb_agg(to_jsonb(v) ORDER BY id) FROM public.system_db_version v),
		'ledger',(SELECT jsonb_agg(to_jsonb(m) ORDER BY filename) FROM public.system_schema_migrations m),
		'identity_sequence',(SELECT jsonb_build_array(last_value,is_called) FROM public.system_front_page_blocks_id_seq)
	)::text`
	before := value(source, snapshot)
	archive := filepath.Join(t.TempDir(), "database.dump")
	// Installation_Update_And_Recovery.md documents authenticated recovery packets;
	// database_recovery_cli.py defaults their database.dump to --format=custom.
	// Full packet creation requires protected installation settings/key custody
	// and application shutdown. Use its underlying tools on this isolated fixture,
	// retaining owners/grants; no installation files or recovery keys are read.
	// This single-threaded fixture is the write freeze: nothing writes during dump
	// or restore. The deliberately newer writer commit happens only after backup.
	run("pg_dump", "--format=custom", "--dbname=home_boxes_912_source", "--file="+archive)

	applySavedHomeMigration(t, source)
	if got := value(source, `SELECT version FROM public.system_db_version ORDER BY id DESC LIMIT 1`); got != "9.13.1" {
		t.Fatalf("newest migrated release = %s, want 9.13.1", got)
	}
	if frontPageCount(t, source, `SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND
		((table_name='system_front_page_blocks' AND ((column_name='title' AND data_type='jsonb' AND is_nullable='YES') OR
		 (column_name='query' AND data_type='jsonb' AND is_nullable='NO') OR
		 (column_name='category_links' AND data_type='smallint' AND is_nullable='NO'))) OR
		 (table_name='system_front_page_revisions' AND column_name='is_custom' AND data_type='boolean' AND is_nullable='NO'))`) != 4 {
		t.Fatal("9.13.1 column definitions missing")
	}
	if frontPageCount(t, source, `SELECT count(*) FROM pg_constraint WHERE conrelid='public.system_front_page_blocks'::regclass
		AND conname='uq_system_front_page_blocks_dataset'`) != 0 {
		t.Fatal("dataset uniqueness survived 9.13.1 migration")
	}
	if value(source, legacyRows) != beforeRows || frontPageCount(t, source, `SELECT count(*) FROM public.system_front_page_blocks
		WHERE title IS NULL AND query='{}'::jsonb AND category_links=3`) != 3 {
		t.Fatal("migration changed legacy ids, positions, limits, enabled flags or timestamps/defaults")
	}
	if frontPageCount(t, source, `SELECT count(*) FROM public.system_front_page_revisions
		WHERE is_custom AND (user_id IS NULL OR user_id=42)`) != 2 {
		t.Fatal("legacy common/personal lists did not become custom")
	}

	common, err := readFrontPageBlocks(source, 0)
	if err != nil || len(common) != 2 {
		t.Fatal("read migrated common list", common, err)
	}
	inputs := []frontPageBlockInput{}
	for _, box := range common {
		inputs = append(inputs, frontPageBlockInput{ID: box.ID, Dataset: box.Dataset, ResultLimit: box.ResultLimit,
			SortOrder: box.SortOrder, Enabled: box.Enabled})
	}
	inputs = append(inputs, frontPageBlockInput{Dataset: common[0].Dataset, ResultLimit: 2, SortOrder: 9, Enabled: true,
		Title: json.RawMessage(`{"en":"Post-backup box"}`)})
	version, err := frontPageScopeVersion(source, 0)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := frontPageTestSave(source, frontPageAdminRequest{Version: version, Blocks: &inputs}); err != nil {
		t.Fatal("post-backup duplicate-dataset writer commit", err)
	}
	var postBackupID int64
	if err := source.QueryRow(`SELECT id FROM public.system_front_page_blocks WHERE title->>'en'='Post-backup box'`).Scan(&postBackupID); err != nil {
		t.Fatal("post-backup write not persisted", err)
	}
	if frontPageCount(t, source, `SELECT count(*) FROM public.system_front_page_blocks`) != 4 ||
		frontPageCount(t, source, `SELECT count(*) FROM public.system_front_page_blocks WHERE user_id IS NULL
		AND table_uid=(SELECT table_uid FROM public.system_db_tables WHERE table_name='tiketit')`) != 2 {
		t.Fatal("new writer must persist a second common box for the same dataset")
	}

	restored := freshDB("home_boxes_912_restored")
	if frontPageCount(t, restored, `SELECT count(*) FROM information_schema.tables WHERE table_schema='public'`) != 0 {
		t.Fatal("restore target is not fresh")
	}
	// Match database_recovery.py's owner/grant-preserving replacement import.
	run("pg_restore", "--exit-on-error", "--single-transaction", "--dbname=home_boxes_912_restored", archive)
	assert912(restored)
	if value(restored, legacyRows) != beforeRows || value(restored, snapshot) != before {
		t.Fatal("restored 9.12.0 schema, constraints, rows, revisions, metadata, release ledger or identity sequence differs from backup")
	}
	var remaining int
	if err := restored.QueryRow(`SELECT count(*) FROM public.system_front_page_blocks WHERE id=$1`, postBackupID).Scan(&remaining); err != nil || remaining != 0 {
		t.Fatalf("post-backup box %d survived restore: count=%d, error=%v", postBackupID, remaining, err)
	}
	if frontPageCount(t, source, `SELECT count(*) FROM public.system_front_page_blocks`) != 4 {
		t.Fatal("restoring the fresh database modified the migrated source")
	}
}
