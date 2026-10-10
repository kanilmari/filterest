// dataset_appearance_postgres_test.go
// Exercises real override persistence, revision races and dataset lifecycle.
// Reuses the Unix-socket-only public-bootstrap PostgreSQL fixture.
// Never reads credentials or connects to an installation database.
package system_table_tools

import (
	"context"
	"database/sql"
	"errors"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	store "easelect/backend/core_components/dataset_appearance_store"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/httpresponse"
	appearance "easelect/frontend/shared/dataset_appearance"
)

const datasetAppearanceMigration = "20261009000003_create_system_dataset_appearance.sql"
const datasetAppearanceSchemaMigration = "20261009000060_extend_dataset_appearance_three_places.sql"

func datasetAppearanceFixture(t *testing.T) (*sql.DB, int) {
	t.Helper()
	db := frontPageDisposableDB(t)
	var uid int
	if err := db.QueryRow(`SELECT table_uid FROM system_db_tables WHERE table_name='wl143_content'`).Scan(&uid); err != nil {
		t.Fatal(err)
	}
	return db, uid
}

func datasetAppearanceTestSave(db *sql.DB, uid int, patch DatasetAppearancePatch, revision string) (DatasetAppearanceSnapshot, error) {
	lazy := dbutils.NewLazyTx(db)
	defer lazy.Rollback()
	tx, ok := dbutils.RequireTx(dbutils.SetLazyTx(context.Background(), lazy))
	if !ok {
		return DatasetAppearanceSnapshot{}, errors.New("test transaction unavailable")
	}
	_, sharedVersion, err := store.ReadShared(tx, false)
	if err != nil {
		return DatasetAppearanceSnapshot{}, err
	}
	snapshot, err := SaveDatasetAppearance(tx, uid, patch, revision, sharedVersion, false)
	if err == nil {
		err = lazy.Commit()
	}
	return snapshot, err
}

func assertDatasetAppearanceRefusal(t *testing.T, err error, status int) {
	t.Helper()
	var refusal *httpresponse.Refusal
	if !errors.As(err, &refusal) || refusal.Status != status {
		t.Fatalf("expected refusal %d: %v", status, err)
	}
}

func TestDatasetAppearancePostgresCreateReadPatchAndEmptyRetention(t *testing.T) {
	db, uid := datasetAppearanceFixture(t)
	initial, err := ReadDatasetAppearance(db, uid, false)
	if err != nil || initial.Revision != "none" || len(initial.Overrides) != 0 || initial.SchemaVersion != 2 || len(initial.TabValues) != 28 {
		t.Fatal(initial, err)
	}
	set := map[string]any{"shared.card_style_variant": "modern", "shared.card_detail_columns": 2}
	created, err := datasetAppearanceTestSave(db, uid, DatasetAppearancePatch{Set: set}, initial.Revision)
	if err != nil || created.Revision != "1" || len(created.Overrides) != 2 {
		t.Fatal(created, err)
	}
	set["shared.card_style_variant"] = "standard"
	read, err := ReadDatasetAppearance(db, uid, false)
	if err != nil || !reflect.DeepEqual(read, created) || read.Overrides["shared.card_style_variant"] != "modern" || read.Overrides["shared.card_detail_columns"] != float64(2) {
		t.Fatal("round trip lost explicit presence", read, err)
	}
	updated, err := datasetAppearanceTestSave(db, uid, DatasetAppearancePatch{Set: map[string]any{"shared.card_detail_columns": 3}, Unset: []string{"shared.card_style_variant"}}, created.Revision)
	if err != nil || updated.Revision != "2" || len(updated.Overrides) != 1 || updated.Overrides["shared.card_detail_columns"] != float64(3) {
		t.Fatal(updated, err)
	}
	if _, err := datasetAppearanceTestSave(db, uid, DatasetAppearancePatch{}, created.Revision); !errors.Is(err, ErrDatasetAppearanceConflict) {
		t.Fatal("stale revision accepted", err)
	}
	empty, err := datasetAppearanceTestSave(db, uid, DatasetAppearancePatch{Unset: []string{"shared.card_detail_columns"}}, updated.Revision)
	if err != nil || empty.Revision != "3" || len(empty.Overrides) != 0 {
		t.Fatal(empty, err)
	}
	read, err = ReadDatasetAppearance(db, uid, false)
	if err != nil || !reflect.DeepEqual(read, empty) || frontPageCount(t, db, `SELECT count(*) FROM system_dataset_appearance WHERE table_uid=`+fmtUID(uid)) != 1 {
		t.Fatal("reset removed revision row", read, err)
	}
	for _, stale := range []string{"none", created.Revision, updated.Revision} {
		_, err := datasetAppearanceTestSave(db, uid, DatasetAppearancePatch{Set: set}, stale)
		assertDatasetAppearanceRefusal(t, err, 409)
	}
	noop, err := datasetAppearanceTestSave(db, uid, DatasetAppearancePatch{}, empty.Revision)
	if err != nil || noop.Revision == empty.Revision {
		t.Fatal("save did not advance durable revision", noop, err)
	}
}

func TestDatasetAppearancePostgresInvalidPatchesRollback(t *testing.T) {
	db, uid := datasetAppearanceFixture(t)
	for _, patch := range []DatasetAppearancePatch{
		{Set: map[string]any{"light.image_blur": nil}}, {Set: map[string]any{"shared.image_blur": 0}},
		{Set: map[string]any{"shared.card_detail_columns": 5}}, {Set: map[string]any{"light.oval_enabled": 0}},
		{Set: map[string]any{"unknown": false}}, {Unset: []string{"unknown"}},
		{Set: map[string]any{"light.image_blur": 0}, Unset: []string{"light.image_blur"}},
		{Set: map[string]any{"light.center_opacity": .8}}, {Set: map[string]any{"light.mid_opacity": .3}},
		{Set: map[string]any{"dark.edge_opacity": .6}}, {Set: map[string]any{"light.center_stop": 60}},
		{Set: map[string]any{"dark.mid_stop": 90}}, {Set: map[string]any{"dark.edge_stop": 50}},
	} {
		_, err := datasetAppearanceTestSave(db, uid, patch, "none")
		assertDatasetAppearanceRefusal(t, err, 400)
		if frontPageCount(t, db, `SELECT count(*) FROM system_dataset_appearance WHERE table_uid=`+fmtUID(uid)) != 0 {
			t.Fatal("invalid initial save left a row")
		}
	}
	// Even a mask unset is outside this slice and must preserve existing card choices.
	valid, err := datasetAppearanceTestSave(db, uid, DatasetAppearancePatch{Set: map[string]any{"shared.card_style_variant": "standard", "shared.card_detail_columns": 2}}, "none")
	if err != nil {
		t.Fatal(err)
	}
	_, err = datasetAppearanceTestSave(db, uid, DatasetAppearancePatch{Unset: []string{"light.mid_opacity"}}, valid.Revision)
	assertDatasetAppearanceRefusal(t, err, 400)
	read, err := ReadDatasetAppearance(db, uid, false)
	if err != nil || !reflect.DeepEqual(read, valid) {
		t.Fatal("invalid patch changed persisted state", read, err)
	}
	// A caller rollback must undo a valid save and its revision as well.
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	_, sharedVersion, err := store.ReadShared(tx, false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := SaveDatasetAppearance(tx, uid, DatasetAppearancePatch{Set: map[string]any{"shared.card_detail_columns": 4}}, valid.Revision, sharedVersion, false); err != nil {
		t.Fatal(err)
	}
	if err := tx.Rollback(); err != nil {
		t.Fatal(err)
	}
	read, err = ReadDatasetAppearance(db, uid, false)
	if err != nil || !reflect.DeepEqual(read, valid) {
		t.Fatal("rollback changed persisted state", read, err)
	}
}

func TestDatasetAppearancePostgresSharedSavePreservesOverrides(t *testing.T) {
	db, uid := datasetAppearanceFixture(t)
	stored, err := datasetAppearanceTestSave(db, uid, DatasetAppearancePatch{Set: map[string]any{"shared.card_style_variant": "standard", "shared.card_detail_columns": 2}}, "none")
	if err != nil {
		t.Fatal(err)
	}
	settings, err := readSitePresentationSettingsFromDB()
	if err != nil {
		t.Fatal(err)
	}
	settings.Defaults["shared.card_image_width"] = 408
	settings.SiteValues["shared.brand_color"] = "#abcdef"
	settings.Defaults["shared.card_detail_columns"] = 4
	lazy := dbutils.NewLazyTx(db)
	defer lazy.Rollback()
	r := httptest.NewRequest("POST", "/api/admin/site-presentation-settings", nil)
	if _, err := persistSitePresentationSettings(r.WithContext(dbutils.SetLazyTx(r.Context(), lazy)), sitePresentationPatchFromSettings(settings)); err != nil {
		t.Fatal(err)
	}
	if err := lazy.Commit(); err != nil {
		t.Fatal(err)
	}
	read, err := ReadDatasetAppearance(db, uid, false)
	if err != nil || !reflect.DeepEqual(read, stored) {
		t.Fatal("shared save rewrote overrides/revision", read, err)
	}
	shared, err := readSitePresentationSettingsFromDB()
	if err != nil {
		t.Fatal(err)
	}
	effective, err := ResolveDatasetAppearance(siteConfigForTest(t, shared), read.TabValues, read.Overrides, false)
	if err != nil || effective.Light.ImageBlur != 1 || effective.Dark.ImageBlur != 1 || effective.Shared.CardImageWidth != 408 || effective.Shared.CardStyleVariant != "standard" || effective.Shared.CardDetailColumns != 2 {
		t.Fatal("shared save froze inheritance or lost equal override", effective, err)
	}
	// Mask writes remain refused even after a shared save, without changing cards.
	_, err = datasetAppearanceTestSave(db, uid, DatasetAppearancePatch{Set: map[string]any{"light.mid_opacity": .7}}, read.Revision)
	assertDatasetAppearanceRefusal(t, err, 400)
	read, err = ReadDatasetAppearance(db, uid, false)
	if err != nil || !reflect.DeepEqual(read, stored) {
		t.Fatal("refused mask save changed card overrides", read, err)
	}
}

func TestDatasetAppearancePostgresConcurrentFirstWrites(t *testing.T) {
	db, uid := datasetAppearanceFixture(t)
	gate := make(chan struct{})
	ready := make(chan error, 2)
	result := make(chan error, 2)
	for _, columns := range []int{1, 4} {
		go func(value int) {
			loaded, err := ReadDatasetAppearance(db, uid, false)
			ready <- err
			<-gate
			if err == nil {
				_, err = datasetAppearanceTestSave(db, uid, DatasetAppearancePatch{Set: map[string]any{"shared.card_detail_columns": value}}, loaded.Revision)
			}
			result <- err
		}(columns)
	}
	for i := 0; i < 2; i++ {
		if err := <-ready; err != nil {
			t.Fatal(err)
		}
	}
	close(gate)
	winners, conflicts := 0, 0
	for i := 0; i < 2; i++ {
		select {
		case err := <-result:
			if err == nil {
				winners++
			} else if errors.Is(err, ErrDatasetAppearanceConflict) {
				assertDatasetAppearanceRefusal(t, err, 409)
				conflicts++
			} else {
				t.Fatal(err)
			}
		case <-time.After(10 * time.Second):
			t.Fatal("competing first writes failed to settle")
		}
	}
	if winners != 1 || conflicts != 1 {
		t.Fatal("competing initial saves", winners, conflicts)
	}
	read, err := ReadDatasetAppearance(db, uid, false)
	if err != nil || read.Revision != "1" || len(read.Overrides) != 1 {
		t.Fatal("loser overwrote winner", read, err)
	}
}

func TestDatasetAppearancePostgresRenameDeleteAndOtherDataset(t *testing.T) {
	db, uid := datasetAppearanceFixture(t)
	stored, err := datasetAppearanceTestSave(db, uid, DatasetAppearancePatch{Set: map[string]any{"shared.card_detail_columns": 1}}, "none")
	if err != nil {
		t.Fatal(err)
	}
	var otherUID int
	if err := db.QueryRow(`INSERT INTO system_db_tables(table_name,schema_name,folder_id) VALUES('wl160_other','public',1) RETURNING table_uid`).Scan(&otherUID); err != nil {
		t.Fatal(err)
	}
	other, err := datasetAppearanceTestSave(db, otherUID, DatasetAppearancePatch{Set: map[string]any{"shared.card_detail_columns": 4}}, "none")
	if err != nil {
		t.Fatal(err)
	}
	// These are isolated lifecycle fixtures, not ad hoc installation repairs.
	frontPageExec(t, db, `ALTER TABLE wl143_content RENAME TO wl160_renamed;
        UPDATE system_db_tables SET table_name='wl160_renamed' WHERE table_name='wl143_content'`)
	read, err := ReadDatasetAppearance(db, uid, false)
	if err != nil || !reflect.DeepEqual(read, stored) {
		t.Fatal("rename lost overrides", read, err)
	}
	frontPageExec(t, db, `DROP TABLE wl160_renamed; DELETE FROM system_db_tables WHERE table_name='wl160_renamed'`)
	if frontPageCount(t, db, `SELECT count(*) FROM system_dataset_appearance WHERE table_uid=`+fmtUID(uid)) != 0 {
		t.Fatal("dataset delete did not cascade exactly its override row")
	}
	if _, err := ReadDatasetAppearance(db, uid, false); !errors.Is(err, ErrDatasetAppearanceNotFound) {
		t.Fatal("deleted dataset read accepted", err)
	}
	_, err = datasetAppearanceTestSave(db, uid, DatasetAppearancePatch{}, stored.Revision)
	assertDatasetAppearanceRefusal(t, err, 404)
	read, err = ReadDatasetAppearance(db, otherUID, false)
	if err != nil || !reflect.DeepEqual(read, other) {
		t.Fatal("another dataset changed", read, err)
	}
}

func TestDatasetAppearancePostgresMigrationReplayAndConstraints(t *testing.T) {
	db, uid := datasetAppearanceFixture(t)
	stored, err := datasetAppearanceTestSave(db, uid, DatasetAppearancePatch{Set: map[string]any{"shared.card_detail_columns": 1}}, "none")
	if err != nil {
		t.Fatal(err)
	}
	content, err := os.ReadFile(filepath.Join("..", "..", "..", "server_tools", "migrations", datasetAppearanceSchemaMigration))
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		frontPageExec(t, db, string(content))
		read, err := ReadDatasetAppearance(db, uid, false)
		if err != nil || !reflect.DeepEqual(read, stored) {
			t.Fatal("migration replay changed stored overrides", read, err)
		}
		if frontPageCount(t, db, `SELECT count(*) FROM app_check_dataset_appearance_storage()`) != 0 ||
			frontPageCount(t, db, `SELECT count(*) FROM system_data_repair_records WHERE migration='dataset_appearance_three_place_schema' AND action='completed'`) != 1 {
			t.Fatal("migration completion/final check failed")
		}
	}
	for _, raw := range []string{`null`, `[]`, `{"light.image_blur":null}`} {
		if _, err := db.Exec(`UPDATE system_dataset_appearance SET overrides=$1::jsonb WHERE table_uid=$2`, raw, uid); err == nil {
			t.Fatal("storage accepted invalid object/null", raw)
		}
	}
	for _, statement := range []string{`UPDATE system_dataset_appearance SET revision=0`, `UPDATE system_dataset_appearance SET schema_version=1`,
		`INSERT INTO system_dataset_appearance(table_uid) VALUES(2147483647)`} {
		if _, err := db.Exec(statement); err == nil {
			t.Fatal("storage constraint accepted", statement)
		}
	}
}

// An upgrade keeps a pre-existing table (CREATE TABLE IF NOT EXISTS), so the migration itself must refuse a malformed
// one before recording completion; a same-named permissive check must not pass for the null refusal.
func TestDatasetAppearancePostgresMigrationRefusesMalformedExistingTable(t *testing.T) {
	db, _ := datasetAppearanceFixture(t)
	content, err := os.ReadFile(filepath.Join("..", "..", "..", "server_tools", "migrations", datasetAppearanceSchemaMigration))
	if err != nil {
		t.Fatal(err)
	}
	frontPageExec(t, db, `ALTER TABLE system_dataset_appearance DROP CONSTRAINT ck_system_dataset_appearance_no_null;
		ALTER TABLE system_dataset_appearance ADD CONSTRAINT ck_system_dataset_appearance_no_null CHECK (true);
		DELETE FROM system_data_repair_records WHERE migration='dataset_appearance_three_place_schema'`)
	// The runner executes an ordinary migration and its ledger insert in one transaction.
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	_, err = tx.Exec(string(content))
	tx.Rollback()
	if err == nil || !strings.Contains(err.Error(), "dataset appearance storage final check refused") {
		t.Fatal("migration accepted a malformed existing table", err)
	}
	if frontPageCount(t, db, `SELECT count(*) FROM system_data_repair_records WHERE migration='dataset_appearance_three_place_schema'`) != 0 {
		t.Fatal("refused migration recorded completion")
	}
}

func TestDatasetAppearancePostgresCompleteTabFirstSaveAndNineOverrides(t *testing.T) {
	db, uid := datasetAppearanceFixture(t)
	initial, err := store.ReadAppearance(db, uid, false)
	if err != nil || initial.Version != "none" {
		t.Fatal(initial, err)
	}
	if len(initial.TabValues) != 28 || len(initial.SiteValues) != 7 || len(initial.Defaults) != 9 {
		t.Fatal(initial)
	}
	set := appearance.Rules().DefaultsForPlace(appearance.SiteDefault)
	set["shared.card_show_all_fields"] = false
	set["shared.filterbar_content_top_space"] = 0
	saved, err := datasetAppearanceTestSave(db, uid, DatasetAppearancePatch{TabSet: map[string]any{"light.image_blur": 0, "dark.oval_enabled": false, "shared.hero_extra_height": 83.5}, Set: set}, "none")
	if err != nil || len(saved.TabValues) != 28 || len(saved.Overrides) != 9 || saved.TabValues["light.image_blur"] != float64(0) {
		t.Fatal(saved, err)
	}
	snapshot, err := store.ReadAppearance(db, uid, false)
	if err != nil || snapshot.Effective.Light.ImageBlur != 0 || snapshot.Effective.Shared.CardShowAllFields || snapshot.Effective.Shared.FilterbarContentTopSpace != 0 || snapshot.Effective.Shared.HeroExtraHeight != 83.5 {
		t.Fatal(snapshot, err)
	}
	for _, path := range appearance.Rules().PathsForPlace(appearance.SiteDefault) {
		if snapshot.Sources[path] != "override" {
			t.Fatal(path)
		}
	}
	for _, theme := range []string{"light", "dark"} {
		_, err := datasetAppearanceTestSave(db, uid, DatasetAppearancePatch{TabSet: map[string]any{theme + ".center_opacity": .9}}, saved.Revision)
		assertDatasetAppearanceRefusal(t, err, 400)
		after, err := ReadDatasetAppearance(db, uid, false)
		if err != nil || !reflect.DeepEqual(after, saved) {
			t.Fatal(after, err)
		}
	}
	cleared, err := datasetAppearanceTestSave(db, uid, DatasetAppearancePatch{Unset: appearance.Rules().PathsForPlace(appearance.SiteDefault)}, saved.Revision)
	if err != nil || len(cleared.Overrides) != 0 || !reflect.DeepEqual(cleared.TabValues, saved.TabValues) || cleared.Revision == saved.Revision {
		t.Fatal(cleared, err)
	}
}
