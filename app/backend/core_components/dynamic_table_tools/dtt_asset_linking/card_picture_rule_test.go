// card_picture_rule_test.go
// Tests current-picture classification and gallery selection across writer paths.
// Between the owner's decisions K120 and K121 and the writers that store cached_image.
// Keeps uploads, adoption, and permission-limited writes on the same card-picture rule.
package dtt_asset_linking

import (
	"database/sql"
	"easelect/backend/core_components/dynamic_table_tools/dtt_card_picture"
	"testing"
	"time"
)

func TestClassifyCardPictureNamesEveryKindOfCurrentPicture(t *testing.T) {
	const libraryPicture = "/storage/media/174668a1-2efa-45a6-aa6c-d8a4ee8ec069/original/image.png"
	cases := []struct {
		name       string
		current    string
		references []string
		existing   []string
		unknown    []string
		canAdopt   bool
		want       dtt_card_picture.CurrentClass
	}{
		{name: "an only copy in the row's own folder can be kept as a gallery row", current: "117_4_4.jpg", existing: []string{"117/4/original/117_4_4.jpg"}, canAdopt: true, want: dtt_card_picture.CurrentAdoptable},
		{name: "one surviving size is enough", current: "117_4_4.jpg", existing: []string{"117/4/300/117_4_4.jpg"}, canAdopt: true, want: dtt_card_picture.CurrentAdoptable},
		{name: "a structured own-folder reference", current: "/storage/117/4/original/117_4_4.jpg", existing: []string{"117/4/1000/117_4_4.jpg"}, canAdopt: true, want: dtt_card_picture.CurrentAdoptable},
		{name: "an older gallery cannot keep an own-folder picture, so it stays", current: "117_4_4.jpg", existing: []string{"117/4/original/117_4_4.jpg"}, canAdopt: false, want: dtt_card_picture.CurrentKept},
		{name: "a picture in another row's folder stays (K121)", current: "117_5_9.jpg", existing: []string{"117/5/original/117_5_9.jpg"}, canAdopt: true, want: dtt_card_picture.CurrentKept},
		{name: "a picture in another dataset's folder stays", current: "612/4/original/612_4_7.png", existing: []string{"612/4/original/612_4_7.png"}, canAdopt: true, want: dtt_card_picture.CurrentKept},
		{name: "a media-library picture stays", current: libraryPicture, existing: []string{"media/174668a1-2efa-45a6-aa6c-d8a4ee8ec069/1000/image.png"}, canAdopt: true, want: dtt_card_picture.CurrentKept},
		{name: "a media-library picture that could not be checked stays", current: libraryPicture, unknown: []string{"media/174668a1-2efa-45a6-aa6c-d8a4ee8ec069/original/image.png"}, canAdopt: true, want: dtt_card_picture.CurrentKept},
		{name: "a media-library picture whose file is certainly gone is no picture", current: libraryPicture, canAdopt: true, want: dtt_card_picture.CurrentBroken},
		{name: "a media-library address naming no library picture is no picture", current: "/storage/media/not-a-uuid/original/image.png", canAdopt: true, want: dtt_card_picture.CurrentBroken},
		{name: "an external address stays", current: "https://example.com/picture.jpg", canAdopt: true, want: dtt_card_picture.CurrentKept},
		{name: "a file that could not be checked stays", current: "117_4_4.jpg", unknown: []string{"117/4/original/117_4_4.jpg"}, canAdopt: true, want: dtt_card_picture.CurrentKept},
		{name: "a certainly missing file is no picture", current: "117_4_4.jpg", canAdopt: true, want: dtt_card_picture.CurrentBroken},
		{name: "a hand-edited path cannot reach outside its folder", current: "../../etc/passwd", existing: []string{"117/4/original/passwd"}, canAdopt: true, want: dtt_card_picture.CurrentBroken},
		{name: "the literal text null seen in a live database", current: "null", canAdopt: true, want: dtt_card_picture.CurrentBroken},
		{name: "a gallery row of any kind carries it", current: "117_4_4.jpg", references: []string{"117_4_9.png", "117_4_4.jpg"}, existing: []string{"117/4/original/117_4_4.jpg"}, canAdopt: true, want: dtt_card_picture.CurrentNone},
		{name: "a gallery row carries the same file under another spelling", current: "117_4_4.jpg", references: []string{"117/4/original/117_4_4.jpg"}, existing: []string{"117/4/original/117_4_4.jpg"}, canAdopt: true, want: dtt_card_picture.CurrentNone},
		{name: "an empty value", current: "  ", canAdopt: true, want: dtt_card_picture.CurrentNone},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			got, reason := ClassifyCardPicture(testCase.current, testCase.references, "117", 4, testCase.canAdopt, cardPictureFiles(testCase.existing, testCase.unknown))
			if got != testCase.want {
				t.Fatalf("ClassifyCardPicture(%q) = %v (%s), want %v", testCase.current, got, reason, testCase.want)
			}
		})
	}
}

func TestDisposableAnUploadBecomesTheCardPictureOnlyWhenTheRowHasNone(t *testing.T) {
	db := previewTestDB(t)
	seedPreviewFixture(t, db)
	usePreviewFiles(t)
	previewExec(t, db, `INSERT INTO about VALUES (1, NULL), (2, NULL), (3, NULL)`)

	// An empty row takes its first upload.
	uploadPicture(t, db, 1, "117_1_1.png")
	if got := previewValue(t, db, 1); got != "117_1_1.png" {
		t.Fatalf("first upload: card = %q, want it", got)
	}
	uploadPicture(t, db, 1, "117_1_2.png")
	if got := previewValue(t, db, 1); got != "117_1_1.png" {
		t.Fatalf("second upload: card = %q, want the first picture kept", got)
	}
	applyAgain(t, db, 1)

	// An existing picture far down the order still wins over a new upload.
	previewExec(t, db, `INSERT INTO about_assets(about_id, filename, sort_order) VALUES (2, '117_2_7.png', 10)`)
	previewExec(t, db, `UPDATE about SET cached_image = '117_2_7.png' WHERE id = 2`)
	uploadPicture(t, db, 2, "117_2_8.png")
	if got := previewValue(t, db, 2); got != "117_2_7.png" {
		t.Fatalf("upload after a picture numbered 10: card = %q, want the existing one", got)
	}

	// An existing picture without an order number counts as 0 and stays first.
	previewExec(t, db, `INSERT INTO about_assets(about_id, filename, sort_order) VALUES (3, '117_3_5.png', NULL)`)
	previewExec(t, db, `UPDATE about SET cached_image = '117_3_5.png' WHERE id = 3`)
	uploadPicture(t, db, 3, "117_3_6.png")
	if got := previewValue(t, db, 3); got != "117_3_5.png" {
		t.Fatalf("upload after an unnumbered picture: card = %q, want the existing one", got)
	}
	applyAgain(t, db, 3)
}

func TestDisposablePrimaryWinsAndAKeptPictureStays(t *testing.T) {
	db := previewTestDB(t)
	seedPreviewFixture(t, db)
	usePreviewFiles(t, "117/5/original/117_5_9.jpg")
	previewExec(t, db, `INSERT INTO about VALUES (1, '117_5_9.jpg'), (2, 'https://example.com/logo.png'), (3, NULL)`)

	for _, parentID := range []int64{1, 2} {
		kept := previewValue(t, db, parentID)
		rowID := uploadPicture(t, db, parentID, "117_"+string(rune('0'+parentID))+"_1.png")
		if got := previewValue(t, db, parentID); got != kept {
			t.Fatalf("row %d after an upload: card = %q, want the kept %q", parentID, got, kept)
		}
		changeGalleryRow(t, db, rowID, `UPDATE about_assets SET is_primary = true WHERE id = $1`, rowID)
		if got := previewValue(t, db, parentID); got != kept {
			t.Fatalf("row %d after marking primary: card = %q, want the kept %q (K121, K127 keep)", parentID, got, kept)
		}
		applyAgain(t, db, parentID)
	}

	// Clearing the field releases the kept picture; the primary takes over.
	gallery, err := dtt_card_picture.PictureRelationOf(db, "about")
	if err != nil {
		t.Fatal(err)
	}
	inTransaction(t, db, func(tx *sql.Tx) {
		previewExec(t, tx, `UPDATE about SET cached_image = NULL WHERE id = 2`)
		if err := ApplyCardPictureRule(tx, "about", gallery, []int64{2}, []string{"https://example.com/logo.png"}); err != nil {
			t.Fatal(err)
		}
	})
	if got := previewValue(t, db, 2); got != "117_2_1.png" {
		t.Fatalf("after clearing: card = %q, want the primary", got)
	}

	// A primary marked on a row without a picture of its own is the card picture.
	first := uploadPicture(t, db, 3, "117_3_1.png")
	second := uploadPicture(t, db, 3, "117_3_2.png")
	changeGalleryRow(t, db, second, `UPDATE about_assets SET is_primary = true WHERE id = $1`, second)
	if got := previewValue(t, db, 3); got != "117_3_2.png" {
		t.Fatalf("after marking primary: card = %q, want the primary", got)
	}
	// Deleting the primary gives the card back to the gallery's first picture.
	changeGalleryRow(t, db, second, `DELETE FROM about_assets WHERE id = $1`, second)
	if got := previewValue(t, db, 3); got != "117_3_1.png" {
		t.Fatalf("after deleting the primary: card = %q, want the first", got)
	}
	// Deleting the picture the card shows never brings it back.
	changeGalleryRow(t, db, first, `DELETE FROM about_assets WHERE id = $1`, first)
	if got := previewValue(t, db, 3); got != "" {
		t.Fatalf("after deleting the last picture: card = %q, want empty", got)
	}
}

func TestDisposableAnAdoptablePictureIsKeptFirstAndComesBack(t *testing.T) {
	db := previewTestDB(t)
	seedPreviewFixture(t, db)
	usePreviewFiles(t, "117/4/original/117_4_4.jpg", "117/4/300/117_4_4.jpg")
	previewExec(t, db, `INSERT INTO about VALUES (4, '117_4_4.jpg')`)

	upload := uploadPicture(t, db, 4, "117_4_9.png")
	if got := previewValue(t, db, 4); got != "117_4_4.jpg" {
		t.Fatalf("after an upload: card = %q, want the own picture, which counts as the first", got)
	}
	if got := galleryCount(t, db, 4, "117_4_4.jpg"); got != 0 {
		t.Fatalf("kept rows = %d before any primary, want none yet", got)
	}

	changeGalleryRow(t, db, upload, `UPDATE about_assets SET is_primary = true WHERE id = $1`, upload)
	if got := previewValue(t, db, 4); got != "117_4_9.png" {
		t.Fatalf("after marking primary: card = %q, want the primary", got)
	}
	var keptOrder, uploadOrder int
	var keptPrimary bool
	var recoveredFrom string
	if err := db.QueryRow(`
		SELECT kept.sort_order, upload.sort_order, kept.is_primary, kept.metadata_json->>'recovered_from'
		  FROM about_assets kept JOIN about_assets upload ON upload.about_id = kept.about_id AND upload.filename = '117_4_9.png'
		 WHERE kept.about_id = 4 AND kept.filename = '117_4_4.jpg'`).Scan(&keptOrder, &uploadOrder, &keptPrimary, &recoveredFrom); err != nil {
		t.Fatalf("kept gallery row not found: %v", err)
	}
	if keptOrder >= uploadOrder || keptPrimary || recoveredFrom != "cached_image" {
		t.Fatalf("kept row: order %d (upload %d), primary %v, recovered_from %q; want it first among the rest, not primary, marked", keptOrder, uploadOrder, keptPrimary, recoveredFrom)
	}
	applyAgain(t, db, 4)

	changeGalleryRow(t, db, upload, `UPDATE about_assets SET is_primary = false WHERE id = $1`, upload)
	if got := previewValue(t, db, 4); got != "117_4_4.jpg" {
		t.Fatalf("after taking the primary mark away: card = %q, want the kept picture back", got)
	}
	if got := galleryCount(t, db, 4, "117_4_4.jpg"); got != 1 {
		t.Fatalf("kept rows = %d, want exactly 1", got)
	}
}

func TestDisposableBrokenAndUncheckablePictures(t *testing.T) {
	db := previewTestDB(t)
	seedPreviewFixture(t, db)
	useCardPictureFileStates(t, nil, []string{"117/2/original/117_2_4.jpg"})
	previewExec(t, db, `INSERT INTO about VALUES (1, '117_1_4.jpg'), (2, '117_2_4.jpg')`)

	uploadPicture(t, db, 1, "117_1_9.png")
	if got := previewValue(t, db, 1); got != "117_1_9.png" {
		t.Fatalf("over a missing file: card = %q, want the upload", got)
	}
	uploadPicture(t, db, 2, "117_2_9.png")
	if got := previewValue(t, db, 2); got != "117_2_4.jpg" {
		t.Fatalf("over a file that could not be checked: card = %q, want it kept", got)
	}
}

func TestDisposableSeveralFilesKeepTheirListOrder(t *testing.T) {
	for _, order := range [][]string{{"117_7_1.png", "117_7_2.png"}, {"117_7_2.png", "117_7_1.png"}} {
		t.Run(order[0], func(t *testing.T) {
			db := previewTestDB(t)
			seedPreviewFixture(t, db)
			usePreviewFiles(t)
			previewExec(t, db, `INSERT INTO about VALUES (7, NULL)`)
			inTransaction(t, db, func(tx *sql.Tx) {
				// A new row's children are created in list order before their files are saved.
				ids := make([]int64, 0, len(order))
				for range order {
					var rowID int64
					if err := tx.QueryRow(`INSERT INTO about_assets(about_id) VALUES (7) RETURNING id`).Scan(&rowID); err != nil {
						t.Fatal(err)
					}
					if err := SettleNewGalleryRows(tx, "about_assets", []int64{rowID}, false); err != nil {
						t.Fatal(err)
					}
					ids = append(ids, rowID)
				}
				// The files arrive in the file map's order, here the reverse.
				for index := len(order) - 1; index >= 0; index-- {
					previewExec(t, tx, `UPDATE about_assets SET filename = $1 WHERE id = $2`, order[index], ids[index])
					if err := ApplyCardPictureRuleForGalleryRows(tx, "about_assets", []int64{ids[index]}); err != nil {
						t.Fatal(err)
					}
				}
			})
			if got := previewValue(t, db, 7); got != order[0] {
				t.Fatalf("card = %q, want the first listed file %q", got, order[0])
			}
		})
	}
}

func TestDisposableAnOlderPictureRelationFollowsTheRule(t *testing.T) {
	db := previewTestDB(t)
	if _, err := db.Exec(`
		CREATE TABLE system_db_tables(table_uid bigint PRIMARY KEY, table_name text, schema_name text);
		CREATE TABLE system_foreign_key_relations_1_m(id bigint PRIMARY KEY, source_table_uid bigint, target_table_uid bigint, source_column_name text, target_insert_specs jsonb);
		CREATE TABLE manuals(id bigint PRIMARY KEY, cached_image text);
		CREATE TABLE manual_pictures(id serial PRIMARY KEY, manual_id integer REFERENCES manuals(id), filename text, created timestamptz DEFAULT now());
		INSERT INTO system_db_tables VALUES (217, 'manuals', 'public'), (218, 'manual_pictures', 'public');
		INSERT INTO system_foreign_key_relations_1_m VALUES (700, 218, 217, 'manual_id',
		  '{"file_upload":{"profile_key":"image","asset_kinds":["image"],"cache_targets":[{"table":"manuals","column":"cached_image"}]}}');
		INSERT INTO manuals VALUES (1, NULL), (2, '217_2_1.jpg');
	`); err != nil {
		t.Fatal(err)
	}
	usePreviewFiles(t, "217/2/original/217_2_1.jpg")
	insert := func(parentID int64, filename string) {
		inTransaction(t, db, func(tx *sql.Tx) {
			var rowID int64
			if err := tx.QueryRow(`INSERT INTO manual_pictures(manual_id, filename) VALUES ($1, $2) RETURNING id`, parentID, filename).Scan(&rowID); err != nil {
				t.Fatal(err)
			}
			if err := SettleNewGalleryRows(tx, "manual_pictures", []int64{rowID}, false); err != nil {
				t.Fatal(err)
			}
		})
	}
	value := func(parentID int64) string {
		var stored sql.NullString
		if err := db.QueryRow(`SELECT cached_image FROM manuals WHERE id = $1`, parentID).Scan(&stored); err != nil {
			t.Fatal(err)
		}
		return stored.String
	}
	insert(1, "217_1_1.jpg")
	time.Sleep(10 * time.Millisecond)
	insert(1, "217_1_2.jpg")
	if got := value(1); got != "217_1_1.jpg" {
		t.Fatalf("older relation without order numbers: card = %q, want the first upload", got)
	}
	insert(2, "217_2_2.jpg")
	if got := value(2); got != "217_2_1.jpg" {
		t.Fatalf("older relation: card = %q, want its own picture kept, since it cannot become a row", got)
	}
}

// A role that may change gallery rows but not insert them still completes its work;
// a picture that would need keeping simply stays where it is.
func TestDisposableWithoutInsertRightThePictureStaysAndTheWorkSucceeds(t *testing.T) {
	db := previewTestDB(t)
	seedPreviewFixture(t, db)
	usePreviewFiles(t, "117/4/original/117_4_4.jpg")
	previewExec(t, db, `INSERT INTO about VALUES (4, '117_4_4.jpg')`)
	previewExec(t, db, `INSERT INTO about_assets(about_id, filename) VALUES (4, '117_4_7.png')`)
	previewExec(t, db, `CREATE ROLE gallery_editor`)
	previewExec(t, db, `GRANT SELECT ON system_db_tables, system_foreign_key_relations_1_m TO gallery_editor`)
	previewExec(t, db, `GRANT SELECT, UPDATE, DELETE ON about, about_assets TO gallery_editor`)

	var childID int64
	if err := db.QueryRow(`SELECT id FROM about_assets WHERE filename = '117_4_7.png'`).Scan(&childID); err != nil {
		t.Fatal(err)
	}
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	previewExec(t, tx, `SET LOCAL ROLE gallery_editor`)
	plan, err := CollectSharedAssetParentCacheSyncPlan(tx, "about_assets", []int64{childID})
	if err != nil {
		t.Fatal(err)
	}
	previewExec(t, tx, `UPDATE about_assets SET is_primary = true WHERE id = $1`, childID)
	if err := ResyncSharedAssetParentCache(tx, plan); err != nil {
		t.Fatalf("the rule failed the change: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("the change could not commit after keeping failed: %v", err)
	}
	if got := previewValue(t, db, 4); got != "117_4_4.jpg" {
		t.Fatalf("card = %q, want the untouched only copy", got)
	}
}
