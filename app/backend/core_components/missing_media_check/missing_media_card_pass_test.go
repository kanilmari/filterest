// missing_media_card_pass_test.go
// Runs the card picture pass of the missing-media check on real PostgreSQL.
// Between every picture field of every dataset, the card picture rule's classification and
// the unused-files walk.
// Exists so a picture only a card shows is never called unused, a card picture whose file is
// gone is reported, the pictures kept from another row's folder are listed (K121), and no file
// is called unused unless every gallery and every picture field was read.
package missing_media_check

import (
	"database/sql"
	"encoding/json"
	"reflect"
	"testing"

	links "easelect/backend/core_components/dynamic_table_tools/dtt_asset_linking"
)

// seedCardPassFixture adds a dataset with a gallery and a card picture column, and a
// dataset without a gallery whose own logo field points into the first one's folder.
func seedCardPassFixture(t *testing.T, storageRoot string) *sql.DB {
	t.Helper()
	db := mediaCheckDisposableDB(t)
	mediaCheckExec(t, db, `
		CREATE TABLE about(id bigint PRIMARY KEY, cached_image text);
		CREATE TABLE about_assets(id serial PRIMARY KEY, about_id bigint, asset_kind text DEFAULT 'image', filename text,
		  sort_order integer DEFAULT 0, is_primary boolean DEFAULT false, created timestamptz DEFAULT now());
		CREATE TABLE brands(id bigint PRIMARY KEY, logo_image text);
		INSERT INTO system_db_tables VALUES (117, 'about', 'public'), (118, 'about_assets', 'public'), (300, 'brands', 'public');
		INSERT INTO about VALUES (1, '117_1_1.jpg'), (2, '117_5_9.jpg'), (3, '117_3_3.jpg'), (4, 'https://example.com/logo.png');
		INSERT INTO about_assets(about_id, filename) VALUES (1, '117_1_1.jpg');
		INSERT INTO brands VALUES (1, '117_6_6.jpg'), (2, '/storage/117/8/original/logo.jpg');
	`)
	specs, err := json.Marshal(links.BuildTargetInsertSpecs(links.BuildImageFileUploadConfig("about", 10, []string{"jpg"})))
	if err != nil {
		t.Fatal(err)
	}
	mediaCheckExec(t, db, `INSERT INTO system_foreign_key_relations_1_m VALUES (659, 118, 117, 'about_id', $1::jsonb)`, string(specs))
	for _, relativePath := range []string{
		"117/1/original/117_1_1.jpg", "117/5/original/117_5_9.jpg", "117/6/original/117_6_6.jpg", "117/7/original/stray.jpg",
		"117/8/original/logo.jpg",
	} {
		writeStorageFile(t, storageRoot, relativePath)
	}
	return db
}

func TestDisposableCardPassReportsCardPicturesAndCountsThemAsReferences(t *testing.T) {
	storageRoot := t.TempDir()
	db := seedCardPassFixture(t, storageRoot)
	result := runCheckOn(t, db, storageRoot, checkSettings(func(settings *Settings) {
		settings.ReportUnusedFiles = true
	}), 1)

	if !result.CardPassComplete || len(result.Errors) != 0 {
		t.Fatalf("card pass complete %v, errors %v; want a complete pass without errors", result.CardPassComplete, result.Errors)
	}
	if result.CardPicturesChecked != 6 {
		t.Fatalf("card pictures checked = %d, want the six non-empty picture values", result.CardPicturesChecked)
	}
	if result.MissingCardPicturesCount != 1 || result.MissingCardPictures[0].Dataset != "about" || result.MissingCardPictures[0].RowID != 3 {
		t.Fatalf("missing card pictures = %+v, want about row 3", result.MissingCardPictures)
	}
	if result.KeptCardPicturesCount != 1 || result.KeptCardPictures[0].RowID != 2 || result.KeptCardPictures[0].OwnerFolder != "117/5" {
		t.Fatalf("kept card pictures = %+v, want about row 2 kept from folder 117/5", result.KeptCardPictures)
	}
	// The card picture of about 2 and the brands' logos are references — the second
	// logo's /storage/ address is placed in folder 117/8 as the writer places it, not in
	// the brand row's own folder — so only the stray file is unused.
	if !reflect.DeepEqual(result.UnusedFiles, []string{"117/7/original/stray.jpg"}) || result.UnusedFilesWithheld != "" {
		t.Fatalf("unused files = %v (withheld %q), want only the stray file", result.UnusedFiles, result.UnusedFilesWithheld)
	}
	if result.SchemaVersion != 3 {
		t.Fatalf("schema version = %d, want 3", result.SchemaVersion)
	}
}

func TestDisposableNoFileIsCalledUnusedUnlessEveryPictureFieldWasRead(t *testing.T) {
	storageRoot := t.TempDir()
	db := seedCardPassFixture(t, storageRoot)
	// The gallery pass spends the whole one-row limit, so the card pass cannot read the
	// picture values at all.
	result := runCheckOn(t, db, storageRoot, checkSettings(func(settings *Settings) {
		settings.ReportUnusedFiles = true
		settings.MaxTotalRowsChecked = 1
		settings.MinRowsPerDataset = 1
	}), 1)
	if result.CardPassComplete {
		t.Fatalf("card pass complete with allowance %d, want it cut short", result.MaxTotalRowsChecked)
	}
	if result.UnusedFilesWithheld != UnusedWithheldCardPassIncomplete || len(result.UnusedFiles) != 0 || result.UnusedFilesCount != 0 {
		t.Fatalf("unused files = %v, withheld %q; want none, withheld because the card pass was cut short", result.UnusedFiles, result.UnusedFilesWithheld)
	}
}
