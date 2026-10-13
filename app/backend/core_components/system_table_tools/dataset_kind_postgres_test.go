// dataset_kind_postgres_test.go
// Proves bootstrap/upgrade classification and real PostgreSQL schema drift.
// Connects the public bootstrap, extension initializer and served locale registry.
// Uses opt-in disposable clusters so installation data and credentials stay untouched.
package system_table_tools

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dataset_kinds"
	"easelect/backend/core_components/dbutils"
	read "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read"
	"easelect/backend/core_components/lang"
	"easelect/backend/core_components/migrations"
	"github.com/lib/pq"
)

func kindRead(t *testing.T, db *sql.DB, name string) dataset_kinds.Capabilities {
	t.Helper()
	c, err := dataset_kinds.ReadForName(context.Background(), db, name)
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func kindLegacyState(t *testing.T, db *sql.DB) string {
	t.Helper()
	var value string
	err := db.QueryRow(`SELECT jsonb_build_object(
 'registry',(SELECT jsonb_agg(to_jsonb(t)-'table_kind'-'kind_version'-'kind_config' ORDER BY id) FROM system_db_tables t),
 'rights',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM system_group_table_func_rights r))::text`).Scan(&value)
	if err != nil {
		t.Fatal(err)
	}
	return value
}

// kindAppSchemaChange uses the same LazyTx after-commit invalidation as
// ModifyColumnsHandler/CreateTableHandler/DropTableHandler. Fixture DDL stands
// in for their schema operation; this proof must not rely on live evidence reads.
func kindAppSchemaChange(t *testing.T, db *sql.DB, name, statement string) {
	t.Helper()
	lt := dbutils.NewLazyTx(db)
	ctx := dbutils.SetLazyTx(context.Background(), lt)
	tx, err := dbutils.RequireTxWithError(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer lt.Rollback()
	if _, err := tx.ExecContext(ctx, statement); err != nil {
		t.Fatal(err)
	}
	dbutils.RegisterAfterCommitHook(ctx, func() { read.InvalidateSchemaCache(name) })
	if err := lt.Commit(); err != nil {
		t.Fatal(err)
	}
}

func assertKindEnabledTranslations(t *testing.T, db *sql.DB) {
	t.Helper()
	assertKindCanonicalTranslations(t, db)
	keys := []string{"table_kind", "kind_version", "kind_config", "dataset_kind_evidence_unavailable"}
	// Legacy ch/yue columns are not canonical registry locales. Require every
	// enabled locale/key pair, including missing keys or translation rows.
	rows, err := db.Query(`SELECT l.language_code, required.lang_key, COALESCE(t.translation,'')
 FROM system_languages l CROSS JOIN unnest($1::text[]) AS required(lang_key)
 LEFT JOIN system_lang_keys k ON k.lang_key=required.lang_key
 LEFT JOIN system_lang_key_translations t ON t.lang_key_id=k.id AND t.language_code=l.language_code
 WHERE l.is_enabled ORDER BY l.language_code, required.lang_key`, pq.Array(keys))
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	languages := []string{}
	for rows.Next() {
		var code, key, translation string
		if err := rows.Scan(&code, &key, &translation); err != nil {
			t.Fatal(err)
		}
		if strings.TrimSpace(translation) == "" {
			t.Errorf("enabled locale %s has no nonblank normalized copy for %s", code, key)
		}
		if len(languages) == 0 || languages[len(languages)-1] != code {
			languages = append(languages, code)
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if err := rows.Close(); err != nil {
		t.Fatal(err)
	}
	if len(languages) == 0 {
		t.Fatal("fixture has no enabled canonical locales to verify")
	}
	// The upgrade database differs from the fresh database bound by the fixture.
	// Verify the endpoint against this database, restoring the binding afterwards.
	oldDB := backend.Db
	backend.Db = db
	defer func() { backend.Db = oldDB }()
	t.Setenv("DEV_MODE", "false")
	for _, code := range languages {
		t.Run("translations/"+code, func(t *testing.T) {
			response := httptest.NewRecorder()
			lang.GetTranslationsHandler(response, httptest.NewRequest(http.MethodGet, "/api/translations?lang="+code, nil))
			if response.Code != http.StatusOK {
				t.Fatalf("translations returned %d: %s", response.Code, response.Body.String())
			}
			var served map[string]string
			if err := json.Unmarshal(response.Body.Bytes(), &served); err != nil {
				t.Fatal(err)
			}
			for _, key := range keys {
				if strings.TrimSpace(served[key]) == "" {
					t.Errorf("enabled locale %s does not serve nonblank copy for %s", code, key)
				}
			}
		})
	}
}

func TestDatasetKindPostgresFreshLegacyEmptyRelationsDrift(t *testing.T) {
	db := frontPageDisposableDB(t)
	if frontPageCount(t, db, `SELECT count(*) FROM system_data_repair_records WHERE migration='wl163_dataset_kind_contracts' AND action='completed'`) != 1 {
		t.Fatal("bootstrap kind marker")
	}
	assertKindEnabledTranslations(t, db)
	// The schema bootstrap installs vector only. Prepare PostGIS in the same
	// schema as server_tools/db_init/01_init_extensions.sh and the restore proof.
	frontPageExec(t, db, `CREATE SCHEMA IF NOT EXISTS postgis;
 CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA postgis;`)
	frontPageExec(t, db, `
 CREATE TABLE kind_host(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
   created timestamptz NOT NULL DEFAULT now(),updated timestamptz NOT NULL DEFAULT now(),
   created_by integer REFERENCES system_users(id) ON DELETE SET NULL,
   owner_id integer REFERENCES system_users(id) ON DELETE SET NULL,embedding_vector vector(768));
 CREATE FUNCTION kind_update() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN NEW.updated=now(); RETURN NEW; END$$;
 CREATE TRIGGER kind_update BEFORE UPDATE ON kind_host FOR EACH ROW EXECUTE FUNCTION kind_update();
 CREATE TABLE unrelated_vector_name(host_row_id bigint REFERENCES kind_host(id) ON DELETE CASCADE,
   language_code text,embedding vector,updated timestamp NOT NULL DEFAULT now(),content_md5 text);
 CREATE TABLE empty_locations(id serial PRIMARY KEY,host_id bigint REFERENCES kind_host(id),position postgis.geometry(Point,4326));
 CREATE TABLE numeric_locations(id serial PRIMARY KEY,lat double precision,lng numeric);
 INSERT INTO system_db_tables(table_name,schema_name,folder_id,multi_lang_embeddings)
 VALUES('kind_host','public',1,true),('unrelated_vector_name','public',1,false),('empty_locations','public',1,false),('numeric_locations','public',1,false);`)
	legacy := kindRead(t, db, "kind_host")
	if !legacy.Conforming || !legacy.Map || !legacy.InlineEmbeddings || !legacy.ChildEmbeddings || legacy.Chat {
		t.Fatal(legacy)
	}
	for _, name := range []string{"empty_locations", "numeric_locations"} {
		if c := kindRead(t, db, name); !c.Conforming || c.Kind != dataset_kinds.Locations || !c.Map {
			t.Fatal(c)
		}
	}
	if c := kindRead(t, db, "unrelated_vector_name"); c.Kind != dataset_kinds.Embeddings || !c.Conforming || c.Map || c.Chat {
		t.Fatal(c)
	}
	kindAppSchemaChange(t, db, "kind_host", `UPDATE system_db_tables SET kind_version=1,kind_config=jsonb_build_object(
 'vector_model','fixture','vector_dimensions',768,
 'embeddings',jsonb_build_object('table_uid',(SELECT table_uid FROM system_db_tables WHERE table_name='unrelated_vector_name'),
 'host_column','id','row_column','host_row_id','value_column','embedding'),
 'locations',jsonb_build_object('table_uid',(SELECT table_uid FROM system_db_tables WHERE table_name='empty_locations'),
 'host_column','id','row_column','host_id','value_column','position')) WHERE table_name='kind_host';`)
	if c := kindRead(t, db, "kind_host"); !c.Conforming || !c.Map || !c.ChildEmbeddings {
		t.Fatal(c)
	}
	// App-path invalidation refreshes warm evidence after the child FK commits.
	kindAppSchemaChange(t, db, "unrelated_vector_name", `ALTER TABLE unrelated_vector_name DROP CONSTRAINT unrelated_vector_name_host_row_id_fkey`)
	if c := kindRead(t, db, "kind_host"); c.Conforming || c.ChildEmbeddings || c.SemanticSearch {
		t.Fatal(c)
	}
	kindAppSchemaChange(t, db, "kind_host", `UPDATE system_db_tables SET kind_config='{}' WHERE table_name='kind_host';
 ALTER TABLE kind_host DISABLE TRIGGER kind_update;`)
	if c := kindRead(t, db, "kind_host"); c.Conforming || c.Map || c.SemanticSearch || c.Chat {
		t.Fatal(c)
	}
	kindAppSchemaChange(t, db, "kind_host", `ALTER TABLE kind_host ENABLE TRIGGER kind_update;`)
	if c := kindRead(t, db, "kind_host"); !c.Conforming {
		t.Fatal(c)
	}
	kindAppSchemaChange(t, db, "kind_host", `DROP TRIGGER kind_update ON kind_host;
 CREATE TRIGGER kind_update BEFORE UPDATE OF embedding_vector ON kind_host FOR EACH ROW EXECUTE FUNCTION kind_update();`)
	if c := kindRead(t, db, "kind_host"); c.Conforming {
		t.Fatalf("partial UPDATE trigger is not timestamp maintenance: %+v", c)
	}
}

func TestDatasetKindPostgresUpgradeReplayPreservesRightsAndDefaults(t *testing.T) {
	current := frontPageDisposableDB(t)
	db := kindProofDatabase(t, current, "kind_upgrade")
	fresh := kindProofDatabase(t, current, "kind_fresh")
	kindImportBootstrap(t, db, true)
	kindImportBootstrap(t, fresh, false)
	if frontPageCount(t, db, `SELECT count(*) FROM system_db_version WHERE version='9.10.1'`) != 1 ||
		frontPageCount(t, db, `SELECT count(*) FROM system_db_version WHERE version='9.11.0'`) != 0 {
		t.Fatal("upgrade must start at released DB 9.10.1")
	}
	frontPageExec(t, db, `UPDATE system_db_tables SET default_view_id=(SELECT id FROM system_table_views WHERE view_key='table' LIMIT 1) WHERE table_name='tiketit';`)
	// The reader also works before the registry extension is installed.
	if c := kindRead(t, db, "tiketit"); !c.Conforming || c.Kind != dataset_kinds.Ordinary || c.Version != 0 {
		t.Fatal(c)
	}
	directory := filepath.Join("..", "..", "..", "server_tools", "migrations")
	paths, err := filepath.Glob(filepath.Join(directory, "*.sql"))
	if err != nil {
		t.Fatal(err)
	}
	kindMigrations := []string{
		"20261009000075_add_dataset_kind_contracts.sql",
		"20261009000076_seed_dataset_kind_language_keys.sql",
	}
	var prefix []string
	pending := map[string]string{}
	for _, path := range paths {
		name := filepath.Base(path)
		if name < kindMigrations[0] {
			prefix = append(prefix, name)
		}
		if frontPageCount(t, db, `SELECT count(*) FROM system_schema_migrations WHERE filename=`+pq.QuoteLiteral(name)) == 0 {
			raw, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			pending[name] = migrations.DescribeMigrationSource(raw).ContentSHA256
		}
	}
	// Run every preceding pending migration through the production runner, then
	// pin the registry/rights immediately before this slice's migrations.
	t.Setenv("EASELECT_MIGRATION_FILE_ALLOWLIST", strings.Join(prefix, ","))
	if err := migrations.RunMigrations(db, directory); err != nil {
		t.Fatal(err)
	}
	if frontPageCount(t, db, `SELECT count(*) FROM system_db_version WHERE version='9.11.0'`) != 0 {
		t.Fatal("release recorded before final pending migrations")
	}
	before := kindLegacyState(t, db)
	// Bracket exactly 75/76; later migrations can intentionally change rights.
	t.Setenv("EASELECT_MIGRATION_FILE_ALLOWLIST", strings.Join(kindMigrations, ","))
	if err := migrations.RunMigrations(db, directory); err != nil {
		t.Fatal(err)
	}
	dataset_kinds.InvalidateAll() // requiredStartupSteps clears after committed migrations.
	if after := kindLegacyState(t, db); after != before {
		t.Fatalf("kind installation changed existing registry, rights or saved defaults\nbefore: %s\nafter: %s", before, after)
	}
	// Finish the full upgrade, including 77 and the release record, before
	// checking execution evidence and fresh/upgrade parity.
	t.Setenv("EASELECT_MIGRATION_FILE_ALLOWLIST", "")
	if err := migrations.RunMigrations(db, directory); err != nil {
		t.Fatal(err)
	}
	dataset_kinds.InvalidateAll()
	if frontPageCount(t, db, `SELECT count(*) FROM system_db_version WHERE version='9.11.0'`) != 1 {
		t.Fatal("complete upgrade did not record DB 9.11.0")
	}
	for name, hash := range pending {
		var got, outcome, provenance string
		if err := db.QueryRow(`SELECT content_sha256,outcome,provenance FROM system_schema_migrations WHERE filename=$1`, name).Scan(&got, &outcome, &provenance); err != nil {
			t.Fatal(name, err)
		}
		if got != hash || outcome != "applied" || provenance != "runner" {
			t.Fatal("pending migration lacks actual execution evidence", name, got, outcome, provenance)
		}
	}
	if len(pending) < 20 {
		t.Fatal("incomplete 9.10.1 upgrade route", len(pending))
	}
	t.Logf("DB 9.10.1 -> 9.11.0: %d pending migrations executed", len(pending))
	assertKindSchemaParity(t, fresh, db)
	for _, name := range []string{"tiketit", "system_users"} {
		if !reflect.DeepEqual(kindRead(t, fresh, name), kindRead(t, db, name)) {
			t.Fatal("fresh/upgrade classification differs", name)
		}
	}
	// Replay must preserve the fully upgraded state, including later changes.
	beforeReplay := kindLegacyState(t, db)
	for i := 0; i < 2; i++ {
		for _, name := range kindMigrations {
			raw, err := os.ReadFile(filepath.Join("..", "..", "..", "server_tools", "migrations", name))
			if err != nil {
				t.Fatal(err)
			}
			frontPageExec(t, db, string(raw))
		}
		if got := kindLegacyState(t, db); got != beforeReplay {
			t.Fatalf("kind migration changed existing registry values, saved defaults or rights\nbefore replay: %s\nafter replay: %s", beforeReplay, got)
		}
	}
	if frontPageCount(t, db, `SELECT count(*) FROM system_data_repair_records WHERE migration='wl163_dataset_kind_contracts' AND action='completed'`) != 1 {
		t.Fatal("replayed marker")
	}
	assertKindEnabledTranslations(t, db)
	if err := migrations.RunMigrations(db, directory); err != nil {
		t.Fatal("runner replay", err)
	}
}
