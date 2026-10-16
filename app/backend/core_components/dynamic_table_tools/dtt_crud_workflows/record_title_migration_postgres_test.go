// record_title_migration_postgres_test.go
// Proves the two exceptional header defaults preserve choices and replay safely.
// Connects the exact upgrade migration to a freshly generated disposable bootstrap.
// Verifies role changes alone, hidden targets and already configured headings.
package dtt_crud_workflows

import (
	"os"
	"path/filepath"
	"testing"
)

func TestRecordTitleHeaderMigrationReplayPostgres(t *testing.T) {
	db, _ := registrationDisposableDB(t)
	loadPublicBootstrap(t, db)
	script, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "server_tools", "migrations", "20261015000002_set_exceptional_record_headers.sql"))
	if err != nil {
		t.Fatal(err)
	}
	for _, target := range []struct{ table, column string }{{"system_audit_log", "handler_name"}, {"system_lang_key_translations", "lang_key_id"}} {
		t.Run(target.table, func(t *testing.T) {
			// Bootstrap must fold in the same role as an upgrade.
			if readCreationRoles(t, db, target.table)[target.column] != "header" {
				t.Fatal("bootstrap lacks header default")
			}
			for _, scenario := range []struct {
				role               string
				hidden, configured bool
				want               string
			}{
				{"details", false, false, "header"}, {"details", true, false, "details"},
				{"description", false, false, "description"}, {"details", false, true, "details"},
			} {
				_, err := db.Exec(`UPDATE system_column_details c SET card_element='details'
 FROM system_db_tables d WHERE c.table_uid=d.table_uid AND d.table_name=$1;
`, target.table)
				if err != nil {
					t.Fatal(err)
				}
				_, err = db.Exec(`UPDATE system_column_details c SET card_element=$1, hide_on_small_card=$2,
 hide_everywhere=false, show_value_on_card=true, client_delivery_mode='include'
 FROM system_db_tables d WHERE c.table_uid=d.table_uid AND d.table_name=$3 AND c.column_name=$4`, scenario.role, scenario.hidden, target.table, target.column)
				if err != nil {
					t.Fatal(err)
				}
				if scenario.configured {
					_, err = db.Exec(`UPDATE system_column_details c SET card_element='header+lang_key'
 FROM system_db_tables d WHERE c.table_uid=d.table_uid AND d.table_name=$1 AND c.column_name='id'`, target.table)
					if err != nil {
						t.Fatal(err)
					}
				}
				for replay := 0; replay < 2; replay++ {
					if _, err := db.Exec(string(script)); err != nil {
						t.Fatal(err)
					}
					if got := readCreationRoles(t, db, target.table)[target.column]; got != scenario.want {
						t.Fatalf("%+v role=%s", scenario, got)
					}
					var hidden bool
					if err := db.QueryRow(`SELECT c.hide_on_small_card FROM system_column_details c JOIN system_db_tables d USING(table_uid)
 WHERE d.table_name=$1 AND c.column_name=$2`, target.table, target.column).Scan(&hidden); err != nil {
						t.Fatal(err)
					}
					if hidden != scenario.hidden {
						t.Fatal("migration changed visibility")
					}
				}
			}
		})
	}
	// The same release's dictionary and version-record migrations also replay
	// without duplicating keys or replacing site-authored copy.
	if _, err := db.Exec(`UPDATE system_lang_keys SET fi='Paikallinen nimi' WHERE lang_key='record_title_without_id';
        UPDATE system_lang_key_translations SET translation='Paikallinen nimi' WHERE language_code='fi'
        AND lang_key_id=(SELECT id FROM system_lang_keys WHERE lang_key='record_title_without_id')`); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"20261015000001_seed_record_title_language_keys.sql", "20261015000099_record_database_release_9_12_0.sql"} {
		sqlSource, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "server_tools", "migrations", name))
		if err != nil {
			t.Fatal(err)
		}
		for replay := 0; replay < 2; replay++ {
			if _, err := db.Exec(string(sqlSource)); err != nil {
				t.Fatalf("%s: %v", name, err)
			}
		}
	}
	var keyCount, versionCount int
	var authored string
	if err := db.QueryRow(`SELECT count(*) FROM system_lang_keys WHERE lang_key IN
        ('record_title_with_id','record_title_without_id','card_role_automatic')`).Scan(&keyCount); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT count(*) FROM system_db_version WHERE version='9.12.0'`).Scan(&versionCount); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT fi FROM system_lang_keys WHERE lang_key='record_title_without_id'`).Scan(&authored); err != nil {
		t.Fatal(err)
	}
	if keyCount != 3 || versionCount != 1 || authored != "Paikallinen nimi" {
		t.Fatalf("keys=%d versions=%d authored=%q", keyCount, versionCount, authored)
	}

}
