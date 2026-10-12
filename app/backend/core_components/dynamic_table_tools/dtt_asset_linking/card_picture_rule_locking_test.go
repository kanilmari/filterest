// card_picture_rule_locking_test.go
// Tests concurrent gallery changes and bounded parent-row lock waits.
// Between competing card-picture writers and the shared disposable PostgreSQL fixture.
// Keeps synchronization from retaining deleted pictures or losing caller lock settings.
package dtt_asset_linking

import (
	"database/sql"
	"easelect/backend/core_components/dynamic_table_tools/dtt_card_picture"
	"testing"
	"time"
)

// Two uploads to an empty row at once: the first to be placed stays first.
func TestDisposableConcurrentUploadsKeepTheFirstPlaced(t *testing.T) {
	db := previewTestDB(t)
	seedPreviewFixture(t, db)
	usePreviewFiles(t)
	previewExec(t, db, `INSERT INTO about VALUES (4, NULL)`)
	db.SetMaxOpenConns(4)

	first, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	var firstID int64
	if err := first.QueryRow(`INSERT INTO about_assets(about_id, filename) VALUES (4, '117_4_10.png') RETURNING id`).Scan(&firstID); err != nil {
		t.Fatal(err)
	}
	if err := SettleNewGalleryRows(first, "about_assets", []int64{firstID}, false); err != nil {
		t.Fatal(err)
	}

	second, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	var secondID int64
	if err := second.QueryRow(`INSERT INTO about_assets(about_id, filename) VALUES (4, '117_4_11.png') RETURNING id`).Scan(&secondID); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- SettleNewGalleryRows(second, "about_assets", []int64{secondID}, false) }()
	select {
	case err := <-done:
		t.Fatalf("the second upload did not wait for the first one's lock: %v", err)
	case <-time.After(300 * time.Millisecond):
	}
	if err := first.Commit(); err != nil {
		t.Fatal(err)
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if err := second.Commit(); err != nil {
		t.Fatal(err)
	}
	if got := previewValue(t, db, 4); got != "117_4_10.png" {
		t.Fatalf("card = %q, want the first placed upload", got)
	}
}

// A row given a card-only picture after the selection is not the alignment's to handle:
// the row is checked again under its lock, and the rule never sees it.
func TestDisposableAlignmentChecksTheRowAgainUnderTheLock(t *testing.T) {
	db := previewTestDB(t)
	seedPreviewFixture(t, db)
	// The only copy of a picture in the row's own folder: the rule itself would keep it
	// as a gallery row and show the primary.
	usePreviewFiles(t, "117/4/original/117_4_4.jpg")
	previewExec(t, db, `INSERT INTO about VALUES (4, '117_4_4.jpg')`)
	previewExec(t, db, `INSERT INTO about_assets(about_id, filename, is_primary) VALUES (4, '117_4_7.png', true)`)
	gallery, err := dtt_card_picture.PictureRelationOf(db, "about")
	if err != nil || gallery == nil {
		t.Fatalf("gallery: %v %v", gallery, err)
	}
	if outcome := alignOneRow(t.Context(), db, alignmentTable{Parent: "about", Gallery: gallery}, 4); outcome != alignNotNeeded {
		t.Fatalf("outcome = %v, want the row left as no candidate", outcome)
	}
	if got := previewValue(t, db, 4); got != "117_4_4.jpg" || galleryCount(t, db, 4, "117_4_4.jpg") != 0 || cardPictureWrites(t, db, 4) != 0 {
		t.Fatalf("the alignment handled a card-only picture: card %q", got)
	}
}

// Two deletes at once: the second waits for the first and decides from what the first
// left, so a deleted picture never stays on the card.
func TestDisposableConcurrentDeletesLeaveNoDeletedPicture(t *testing.T) {
	db := previewTestDB(t)
	seedPreviewFixture(t, db)
	usePreviewFiles(t)
	previewExec(t, db, `INSERT INTO about VALUES (4, '117_4_1.png')`)
	previewExec(t, db, `INSERT INTO about_assets(id, about_id, filename, sort_order) VALUES (1, 4, '117_4_1.png', 0), (2, 4, '117_4_2.png', 1)`)
	db.SetMaxOpenConns(4)

	deleteRow := func(tx *sql.Tx, rowID int64) error {
		plan, err := CollectSharedAssetParentCacheSyncPlan(tx, "about_assets", []int64{rowID})
		if err != nil {
			return err
		}
		if _, err := tx.Exec(`DELETE FROM about_assets WHERE id = $1`, rowID); err != nil {
			return err
		}
		return ResyncSharedAssetParentCache(tx, plan)
	}
	first, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	if err := deleteRow(first, 1); err != nil {
		t.Fatal(err)
	}
	second, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- deleteRow(second, 2) }()
	select {
	case err := <-done:
		t.Fatalf("the second delete decided without waiting for the first: %v", err)
	case <-time.After(300 * time.Millisecond):
	}
	if err := first.Commit(); err != nil {
		t.Fatal(err)
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if err := second.Commit(); err != nil {
		t.Fatal(err)
	}
	if got := previewValue(t, db, 4); got != "" {
		t.Fatalf("card = %q after both pictures were deleted, want none", got)
	}
}

// A writer that cannot get the parent's lock in time leaves the card picture as it is,
// and the caller's own work still commits with the caller's lock wait back in place.
func TestDisposableALockWaitThatRunsOutLeavesTheCardAndTheWorkIntact(t *testing.T) {
	db := previewTestDB(t)
	seedPreviewFixture(t, db)
	usePreviewFiles(t)
	previewExec(t, db, `INSERT INTO about VALUES (4, NULL)`)
	db.SetMaxOpenConns(4)
	gallery, err := dtt_card_picture.PictureRelationOf(db, "about")
	if err != nil || gallery == nil {
		t.Fatalf("gallery: %v %v", gallery, err)
	}

	holder, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = holder.Rollback() }()
	// The lock a writer of the card picture holds; adding a gallery row still passes it.
	previewExec(t, holder, `SELECT id FROM about WHERE id = 4 FOR NO KEY UPDATE`)

	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	previewExec(t, tx, `INSERT INTO about_assets(about_id, filename, sort_order) VALUES (4, '117_4_1.png', 0)`)
	started := time.Now()
	if err := ApplyCardPictureRule(tx, "about", gallery, []int64{4}, nil); err != nil {
		t.Fatalf("a lock wait that ran out failed the caller's work: %v", err)
	}
	if waited := time.Since(started); waited < 4*time.Second || waited > 15*time.Second {
		t.Fatalf("waited %v for the parent's lock, want about %d ms", waited, cardPictureLockWaitMillis)
	}
	var millis int64
	if err := tx.QueryRow(`SELECT setting::bigint FROM pg_settings WHERE name = 'lock_timeout'`).Scan(&millis); err != nil {
		t.Fatal(err)
	}
	if millis != 0 {
		t.Fatalf("lock wait after the rule = %d ms, want the caller's own (none) back", millis)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("the caller's work could not commit: %v", err)
	}
	if err := holder.Rollback(); err != nil {
		t.Fatal(err)
	}
	if got := previewValue(t, db, 4); got != "" || galleryCount(t, db, 4, "117_4_1.png") != 1 {
		t.Fatalf("card = %q and the gallery row count is %d; want the card untouched and the row kept", got, galleryCount(t, db, 4, "117_4_1.png"))
	}
}

// A writer waits a bounded time for a parent row, and the caller's own setting comes back.
func TestDisposableParentLockWaitIsBoundedAndRestored(t *testing.T) {
	db := previewTestDB(t)
	lockTimeout := func(tx *sql.Tx) int64 {
		t.Helper()
		var millis int64
		if err := tx.QueryRow(`SELECT setting::bigint FROM pg_settings WHERE name = 'lock_timeout'`).Scan(&millis); err != nil {
			t.Fatal(err)
		}
		return millis
	}
	inTransaction(t, db, func(tx *sql.Tx) {
		var during int64
		if err := withParentLockWait(tx, func() error { during = lockTimeout(tx); return nil }); err != nil {
			t.Fatal(err)
		}
		if during != cardPictureLockWaitMillis || lockTimeout(tx) != 0 {
			t.Fatalf("wait during = %d, after = %d; want %d, then no limit as before", during, lockTimeout(tx), cardPictureLockWaitMillis)
		}
		previewExec(t, tx, `SET LOCAL lock_timeout = '2s'`)
		if err := withParentLockWait(tx, func() error { during = lockTimeout(tx); return nil }); err != nil {
			t.Fatal(err)
		}
		if during != 2000 || lockTimeout(tx) != 2000 {
			t.Fatalf("a shorter wait the caller chose became %d, then %d; want it kept", during, lockTimeout(tx))
		}
	})
}
