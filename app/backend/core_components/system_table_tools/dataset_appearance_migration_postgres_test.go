// dataset_appearance_migration_postgres_test.go
// Proves fresh and slice-2 upgrade card cutover using real disposable PostgreSQL.
// Connects reviewed bootstrap inputs, explicit legacy choices and compatibility reads.
// Replays twice and preserves explicit equality, extra leaves and durable revisions.
package system_table_tools

import (
	"database/sql"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"testing"

	store "easelect/backend/core_components/dataset_appearance_store"
)

func TestDatasetAppearancePostgresLegacyMigrationFreshUpgradeAndReplay(t *testing.T) {
	current := frontPageDisposableDB(t)
	var socket, port string
	if err := current.QueryRow(`SELECT current_setting('unix_socket_directories'),current_setting('port')`).Scan(&socket, &port); err != nil {
		t.Fatal(err)
	}
	frontPageExec(t, current, `CREATE DATABASE appearance_upgrade`)
	upgraded, err := sql.Open("postgres", fmt.Sprintf("host=%s port=%s user=fixture_owner dbname=appearance_upgrade sslmode=disable", socket, port))
	if err != nil {
		t.Fatal(err)
	}
	defer upgraded.Close()
	for _, name := range []string{"schema.sql", "seed_data.sql"} {
		data, err := exec.Command("git", "show", "dbda048:app/server_tools/public_bootstrap/"+name).Output()
		if err != nil {
			t.Fatal(err)
		}
		frontPageExec(t, upgraded, string(data))
	}
	frontPageExec(t, upgraded, `UPDATE system_db_tables SET card_style_variant='modern',card_detail_columns=2 WHERE table_name='tiketit';
 INSERT INTO system_dataset_appearance(table_uid,overrides,revision)
 SELECT table_uid,'{"light.image_blur":0}',7 FROM system_db_tables WHERE table_name='tiketit';`)
	migration, err := os.ReadFile(filepath.Join("..", "..", "..", "server_tools", "migrations", "20261009000040_cut_over_dataset_card_appearance.sql"))
	if err != nil {
		t.Fatal(err)
	}
	frontPageExec(t, upgraded, string(migration))
	for _, db := range []*sql.DB{current, upgraded} {
		uid, err := store.UIDForName(db, "tiketit")
		if err != nil {
			t.Fatal(err)
		}
		before, err := store.ReadAppearance(db, uid, false)
		if err != nil {
			t.Fatal(err)
		}
		if db == upgraded {
			if before.Version != "8" || before.Overrides["light.image_blur"] != float64(0) || before.Sources["shared.card_style_variant"] != "override" || before.Sources["shared.card_detail_columns"] != "override" || before.Effective.Light.ImageBlur != 0 || before.Effective.Shared.CardStyleVariant != "modern" || before.Effective.Shared.CardDetailColumns != 2 {
				t.Fatal("legacy equality or extra leaves lost", before)
			}
			_, card, err := loadCardVisibilityTableSettings(db, "tiketit")
			if err != nil || card.CardStyleVariant == nil || *card.CardStyleVariant != "modern" || card.CardDetailColumns == nil || *card.CardDetailColumns != 2 {
				t.Fatal(card, err)
			}
		} else if len(before.Overrides) != 0 {
			t.Fatal("fresh install materialized inherited choices", before)
		}
		for i := 0; i < 2; i++ {
			frontPageExec(t, db, string(migration))
			after, err := store.ReadAppearance(db, uid, false)
			if err != nil || !reflect.DeepEqual(before, after) {
				t.Fatal("cutover replay changed settings", after, err)
			}
		}
		if count := frontPageCount(t, db, `SELECT count(*) FROM app_check_dataset_card_appearance_cutover()`); count != 0 {
			t.Fatal("cutover final check", count)
		}
	}
}
