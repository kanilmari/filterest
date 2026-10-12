// card_picture_rule_alignment_test.go
// Tests startup alignment, restore preservation, and referenced-file moves.
// Between cached card pictures, gallery rows, and the shared disposable PostgreSQL fixture.
// Keeps maintenance and restore paths idempotent without losing a retained picture.
package dtt_asset_linking

import (
	"database/sql"
	"easelect/backend/core_components/dynamic_table_tools/dtt_card_picture"
	"testing"
	"time"
)

func TestDisposableStartupAlignmentFixesOnlyGalleryChoicesAndRepeatsNothing(t *testing.T) {
	db := previewTestDB(t)
	seedPreviewFixture(t, db)
	usePreviewFiles(t, "117/5/original/117_5_9.jpg")
	previewExec(t, db, `INSERT INTO about VALUES (1, '117_1_2.png'), (2, NULL), (3, '117_5_9.jpg'), (4, '117_4_1.png'), (6, '117_6_2.png')`)
	previewExec(t, db, `INSERT INTO about_assets(about_id, filename, sort_order) VALUES
		(1, '117_1_1.png', 0), (1, '117_1_2.png', 1),
		(2, '117_2_1.png', 0),
		(3, '117_3_1.png', 0),
		(4, '117_4_1.png', 0), (4, '117_4_2.png', 1),
		(6, '117_6_1.png', 0), (6, '117_6_2.png', 1)`)

	// Row 6 is locked by someone else: it is skipped and stays a candidate.
	holder, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	previewExec(t, holder, `SELECT id FROM about WHERE id = 6 FOR UPDATE`)
	result, err := AlignCardPictures(t.Context(), db, 30*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if err := holder.Rollback(); err != nil {
		t.Fatal(err)
	}
	if result.Changed != 2 || result.Skipped != 1 || result.Failed != 0 || !result.Complete {
		t.Fatalf("first alignment = %+v, want rows 1 and 2 changed and the locked row 6 skipped", result)
	}
	want := map[int64]string{1: "117_1_1.png", 2: "117_2_1.png", 3: "117_5_9.jpg", 4: "117_4_1.png", 6: "117_6_2.png"}
	for parentID, value := range want {
		if got := previewValue(t, db, parentID); got != value {
			t.Fatalf("row %d after the first alignment = %q, want %q", parentID, got, value)
		}
	}

	result, err = AlignCardPictures(t.Context(), db, 30*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if result.Changed != 1 || result.Skipped != 0 || !result.Complete || previewValue(t, db, 6) != "117_6_1.png" {
		t.Fatalf("second alignment = %+v, row 6 = %q; want only the formerly locked row changed", result, previewValue(t, db, 6))
	}
	writes := cardPictureWrites(t, db, 1) + cardPictureWrites(t, db, 2) + cardPictureWrites(t, db, 6)
	result, err = AlignCardPictures(t.Context(), db, 30*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if result.Changed != 0 || result.Skipped != 0 || cardPictureWrites(t, db, 1)+cardPictureWrites(t, db, 2)+cardPictureWrites(t, db, 6) != writes {
		t.Fatalf("third alignment = %+v, want nothing selected and nothing written", result)
	}
}

// A restore never overwrites a picture the rule keeps, an empty cell included; an only
// copy in the row's own folder becomes a gallery row first, or stays when it cannot.
func TestDisposableARestoreNeverOverwritesAPictureTheRuleKeeps(t *testing.T) {
	db := previewTestDB(t)
	seedPreviewFixture(t, db)
	usePreviewFiles(t, "117/5/original/117_5_9.jpg", "117/3/original/117_3_3.jpg", "117/6/original/117_6_6.jpg")
	previewExec(t, db, `INSERT INTO about VALUES (2, '117_5_9.jpg'), (3, '117_3_3.jpg'), (4, '117_4_1.png'), (6, '117_6_6.jpg')`)
	previewExec(t, db, `INSERT INTO about_assets(about_id, filename) VALUES (4, '117_4_1.png')`)
	gallery, err := dtt_card_picture.PictureRelationOf(db, "about")
	if err != nil || gallery == nil {
		t.Fatalf("gallery: %v %v", gallery, err)
	}
	resolve := func(q sharedAssetCacheQueryExecer, parentID int64, restored string) (bool, string) {
		t.Helper()
		keep, stored, err := ResolveRestoredCardPicture(q, "about", gallery, parentID, restored)
		if err != nil {
			t.Fatal(err)
		}
		return keep, stored
	}
	inTransaction(t, db, func(tx *sql.Tx) {
		// Another row's folder: kept against a value and against an empty cell.
		for _, restored := range []string{"117_2_8.png", ""} {
			if keep, stored := resolve(tx, 2, restored); !keep || stored != "117_5_9.jpg" {
				t.Fatalf("restoring %q over a kept picture: keep %v, stored %q; want it kept", restored, keep, stored)
			}
		}
		// An only copy in the row's own folder becomes a gallery row; the value may go.
		if keep, _ := resolve(tx, 3, ""); keep {
			t.Fatal("an only copy that became a gallery row was still held back")
		}
		// A picture a gallery row carries may be replaced.
		if keep, _ := resolve(tx, 4, "117_4_2.png"); keep {
			t.Fatal("a gallery picture held back the restore")
		}
	})
	if galleryCount(t, db, 3, "117_3_3.jpg") != 1 {
		t.Fatal("the only copy was not kept as a gallery row")
	}

	// Without the right to add gallery rows the only copy stays where it is.
	previewExec(t, db, `CREATE ROLE restorer`)
	previewExec(t, db, `GRANT SELECT ON ALL TABLES IN SCHEMA public TO restorer`)
	previewExec(t, db, `GRANT UPDATE ON about TO restorer`)
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback() }()
	previewExec(t, tx, `SET LOCAL ROLE restorer`)
	if keep, stored := resolve(tx, 6, "117_6_1.png"); !keep || stored != "117_6_6.jpg" {
		t.Fatalf("an only copy that could not become a row: keep %v, stored %q; want it kept", keep, stored)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("the restore could not go on after keeping failed: %v", err)
	}
}

func TestDisposableFileMovesSkipFilesStillReferenced(t *testing.T) {
	db := previewTestDB(t)
	seedPreviewFixture(t, db)
	previewExec(t, db, `INSERT INTO about VALUES (4, '117_4_4.jpg'), (5, '117_5_3.png')`)
	previewExec(t, db, `INSERT INTO about_assets(id, about_id, filename) VALUES
		(1, 4, '117_4_4.jpg'), (2, 4, '117/4/original/117_4_4.jpg'), (3, 4, '117_4_8.png'),
		(4, 5, '117_5_3.png'), (5, 5, '117_5_6.png')`)

	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	moves, err := CollectSharedAssetFileMoves(tx, "about_assets", []int64{1, 3, 5})
	if err != nil {
		t.Fatal(err)
	}
	previewExec(t, tx, `DELETE FROM about_assets WHERE id IN (1, 3, 5)`)
	// Parent 5's card picture still names 117_5_6.png, as when the rule kept it.
	previewExec(t, tx, `UPDATE about SET cached_image = '117_5_6.png' WHERE id = 5`)
	kept := OmitStillReferencedSharedAssetFileMoves(tx, "about_assets", moves)
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	if len(kept) != 1 || kept[0].Filename != "117_4_8.png" || kept[0].StorageRowID != 4 {
		t.Fatalf("file moves = %#v, want only the unreferenced 117_4_8.png", kept)
	}
}
