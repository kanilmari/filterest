// translation_ui_objects_postgres_test.go
// Proves private names, upgrade-only links and shared readable column labels.
// Uses the unchanged label creator and 000006 migration on disposable PostgreSQL.
// Generic builder evidence must never turn private names into public UI copy.
package lang

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"easelect/backend/core_components/lang_key_naming"
)

func TestTranslationPrivateLegacyAndSharedBindingsPostgres(t *testing.T) {
	var notices []string
	db := translationDisposableDB(t, &notices)
	exec := func(query string) {
		t.Helper()
		if _, err := db.Exec(query); err != nil {
			t.Fatal(err)
		}
	}
	exec(translationPostgresFixture)
	exec(`CREATE TABLE zz_priv_ledger(id integer,zz_secret_band text);
 CREATE TABLE pub_a(id integer,active text);
 CREATE TABLE zz_priv_b(id integer,active text);
 INSERT INTO system_db_tables VALUES(71,'zz_priv_ledger','public',false),(72,'pub_a','public',false),(73,'zz_priv_b','public',false);
 INSERT INTO system_column_details(table_uid,column_name) VALUES(71,'zz_secret_band'),(72,'active'),(73,'active');
 INSERT INTO system_table_folders(folder_name) VALUES('zz_priv_folder');
 INSERT INTO system_group_table_func_rights VALUES(3,1,72),(4,1,71),(4,2,NULL);
 INSERT INTO system_lang_keys(lang_key,en) VALUES('zz_priv_folder','Private folder');`)
	for _, dataset := range []string{"zz_priv_ledger", "pub_a", "zz_priv_b"} {
		column := "active"
		if dataset == "zz_priv_ledger" {
			column = "zz_secret_band"
		}
		if err := EnsureDatasetInterfaceLabels(db, dataset, []string{column}); err != nil {
			t.Fatal(err)
		}
	}
	exec(`INSERT INTO system_lang_key_sources(lang_key_id,source_type,source_high,source_low,last_seen)
 SELECT id,'folder','zz_priv_folder','zz_priv_folder',CURRENT_DATE FROM system_lang_keys WHERE lang_key='zz_priv_folder';
 INSERT INTO system_lang_key_sources(lang_key_id,source_type,source_high,source_low,last_seen)
 SELECT id,'code','app/backend/lang_key_naming/lang_key_naming.go','',CURRENT_DATE FROM system_lang_keys;`)
	private := append([]string{"zz_priv_ledger", "zz_priv_folder", "zz_secret_band", "zz_secret_band_asc", "zz_secret_band_desc"}, lang_key_naming.DatasetOwnedKeyNames("zz_priv_ledger")...)
	check := func() {
		t.Helper()
		values, err := ReadDisplayTranslations("en")
		if err != nil {
			t.Fatal(err)
		}
		for _, user := range []int{1, 42, 99} {
			scope, err := readTranslationScope(db, user)
			if err != nil {
				t.Fatal(err)
			}
			served, err := filterTranslationMap(context.Background(), values, scope)
			if err != nil {
				t.Fatal(err)
			}
			for _, key := range private {
				if _, has := served[key]; has != (user != 1) {
					t.Fatalf("user=%d key=%s has=%v", user, key, has)
				}
			}
			// G3: no literal marker exists; the readable pub_a binding suffices.
			if user == 1 {
				for _, key := range []string{"active", "active_asc", "active_desc"} {
					if served[key] == "" {
						t.Fatal("readable shared key withheld", key)
					}
				}
			}
		}
	}
	check()
	// G2: remove creator links in the disposable upgrade fixture, leaving only
	// generic code provenance. Only the original 000006 backfill restores links.
	exec(`DELETE FROM system_lang_key_sources WHERE source_type IN ('table','column','folder')`)
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "server_tools", "migrations", "20261015000006_backfill_translation_object_sources.sql"))
	if err != nil {
		t.Fatal(err)
	}
	exec(string(raw))
	check()
	var before, after int
	if err := db.QueryRow(`SELECT count(*) FROM system_lang_key_sources`).Scan(&before); err != nil {
		t.Fatal(err)
	}
	exec(string(raw))
	if err := db.QueryRow(`SELECT count(*) FROM system_lang_key_sources`).Scan(&after); err != nil || before != after {
		t.Fatal("legacy links changed", before, after, err)
	}
	check()
}
