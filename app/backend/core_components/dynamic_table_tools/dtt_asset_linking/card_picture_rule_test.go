// card_picture_rule_test.go
// Tests the one card picture rule against real PostgreSQL: every writer path, every kind of
// current picture, and a second application that must change nothing.
// Between the owner's decisions K120 and K121 and the writers that store cached_image.
// Exists because a card's picture switched back by itself (an upload chose one way, the next
// gallery change another) and because About row 4 lost its only picture on 23.9.2026.
package dtt_asset_linking

import (
	"database/sql"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"easelect/backend/core_components/dynamic_table_tools/dtt_card_picture"
	media_utils "easelect/backend/core_components/media_utils"
)

// cardPictureFiles answers the probe from fixed sets: listed files exist, unknown ones
// could not be checked, everything else is missing.
func cardPictureFiles(existing []string, unknown []string) func(string) media_utils.StoredFileStatus {
	exists := make(map[string]bool, len(existing))
	for _, relativePath := range existing {
		exists[relativePath] = true
	}
	unchecked := make(map[string]bool, len(unknown))
	for _, relativePath := range unknown {
		unchecked[relativePath] = true
	}
	return func(relativePath string) media_utils.StoredFileStatus {
		switch {
		case exists[relativePath]:
			return media_utils.StoredFileExists
		case unchecked[relativePath]:
			return media_utils.StoredFileUnknown
		default:
			return media_utils.StoredFileMissing
		}
	}
}

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

// ── disposable PostgreSQL ──────────────────────────────────────────────

// previewTestDB starts an isolated PostgreSQL 16 cluster reachable only through a
// private socket, so the rule's real SQL, locks and privileges are exercised.
func previewTestDB(t *testing.T) *sql.DB {
	t.Helper()
	if os.Getenv("FILTEREST_TEST_DISPOSABLE_POSTGRES") != "1" {
		t.Skip("set FILTEREST_TEST_DISPOSABLE_POSTGRES=1")
	}
	root, err := os.MkdirTemp("", "fpv-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(root) })
	socket := filepath.Join(root, "s")
	if err := os.Mkdir(socket, 0700); err != nil {
		t.Fatal(err)
	}
	bin := "/usr/lib/postgresql/16/bin/"
	run := func(name string, args ...string) {
		t.Helper()
		if output, err := exec.Command(bin+name, args...).CombinedOutput(); err != nil {
			t.Fatalf("%s: %v %s", name, err, output)
		}
	}
	data := filepath.Join(root, "db")
	run("initdb", "-D", data, "-A", "trust", "-U", "test_owner", "--no-locale", "--encoding=UTF8")
	run("pg_ctl", "-D", data, "-l", filepath.Join(root, "pg.log"), "-o", "-h '' -k '"+socket+"' -p 15461", "-w", "start")
	t.Cleanup(func() {
		_, _ = exec.Command(bin+"pg_ctl", "-D", data, "-m", "fast", "-w", "stop").CombinedOutput()
	})
	db, err := sql.Open("postgres", "host="+socket+" port=15461 user=test_owner dbname=postgres sslmode=disable")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

const previewFixtureSchema = `
CREATE TABLE system_db_tables(table_uid bigint PRIMARY KEY, table_name text, schema_name text);
CREATE TABLE system_foreign_key_relations_1_m(id bigint PRIMARY KEY, source_table_uid bigint, target_table_uid bigint, source_column_name text, target_insert_specs jsonb);
CREATE TABLE about(id bigint PRIMARY KEY, cached_image text);
CREATE TABLE about_assets(id serial PRIMARY KEY, about_id integer REFERENCES about(id) ON DELETE CASCADE,
 asset_kind text NOT NULL DEFAULT 'image', filename text, sort_order integer DEFAULT 0,
 is_primary boolean NOT NULL DEFAULT false, metadata_json jsonb, created timestamptz DEFAULT now(), updated timestamptz DEFAULT now());
INSERT INTO system_db_tables VALUES (117, 'about', 'public'), (118, 'about_assets', 'public');
-- Counts real writes of the card picture, so a second application can be shown to write nothing.
CREATE TABLE card_picture_writes(parent_id bigint, value text);
CREATE FUNCTION count_card_picture_write() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.cached_image IS DISTINCT FROM OLD.cached_image OR TG_OP = 'UPDATE' THEN
    INSERT INTO card_picture_writes VALUES (NEW.id, NEW.cached_image);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER about_card_picture_writes AFTER UPDATE OF cached_image ON about FOR EACH ROW EXECUTE FUNCTION count_card_picture_write();
`

func seedPreviewFixture(t *testing.T, db *sql.DB) {
	t.Helper()
	if _, err := db.Exec(previewFixtureSchema); err != nil {
		t.Fatal(err)
	}
	specs, err := json.Marshal(BuildTargetInsertSpecs(BuildImageFileUploadConfig("about", 10, []string{"png", "jpg"})))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO system_foreign_key_relations_1_m VALUES (659, 118, 117, 'about_id', $1)`, string(specs)); err != nil {
		t.Fatal(err)
	}
}

// usePreviewFiles makes the rule see exactly these storage-relative files.
func usePreviewFiles(t *testing.T, relativePaths ...string) {
	t.Helper()
	useCardPictureFileStates(t, relativePaths, nil)
}

func useCardPictureFileStates(t *testing.T, existing []string, unknown []string) {
	t.Helper()
	original := cardPictureFileState
	cardPictureFileState = cardPictureFiles(existing, unknown)
	t.Cleanup(func() { cardPictureFileState = original })
}

func previewExec(t *testing.T, q interface {
	Exec(string, ...interface{}) (sql.Result, error)
}, query string, args ...interface{}) {
	t.Helper()
	if _, err := q.Exec(query, args...); err != nil {
		t.Fatalf("%s: %v", query, err)
	}
}

func previewValue(t *testing.T, db *sql.DB, parentID int64) string {
	t.Helper()
	var value sql.NullString
	if err := db.QueryRow(`SELECT cached_image FROM about WHERE id = $1`, parentID).Scan(&value); err != nil {
		t.Fatal(err)
	}
	return value.String
}

func galleryCount(t *testing.T, db *sql.DB, parentID int64, filename string) int {
	t.Helper()
	var count int
	if err := db.QueryRow(`SELECT count(*) FROM about_assets WHERE about_id = $1 AND filename = $2`, parentID, filename).Scan(&count); err != nil {
		t.Fatal(err)
	}
	return count
}

func cardPictureWrites(t *testing.T, db *sql.DB, parentID int64) int {
	t.Helper()
	var count int
	if err := db.QueryRow(`SELECT count(*) FROM card_picture_writes WHERE parent_id = $1`, parentID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	return count
}

func inTransaction(t *testing.T, db *sql.DB, work func(tx *sql.Tx)) {
	t.Helper()
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	work(tx)
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
}

// uploadPicture mirrors adding a gallery row with its stored file: the row is created,
// placed after the parent's other pictures, and the rule runs.
func uploadPicture(t *testing.T, db *sql.DB, parentID int64, filename string) int64 {
	t.Helper()
	var rowID int64
	inTransaction(t, db, func(tx *sql.Tx) {
		if err := tx.QueryRow(`INSERT INTO about_assets(about_id, filename) VALUES ($1, $2) RETURNING id`, parentID, filename).Scan(&rowID); err != nil {
			t.Fatal(err)
		}
		if err := SettleNewGalleryRows(tx, "about_assets", []int64{rowID}, false); err != nil {
			t.Fatal(err)
		}
	})
	return rowID
}

// changeGalleryRow mirrors the row edit and delete handlers: collect before, change,
// add the parents after, apply the rule.
func changeGalleryRow(t *testing.T, db *sql.DB, rowID int64, change string, args ...interface{}) {
	t.Helper()
	inTransaction(t, db, func(tx *sql.Tx) {
		plan, err := CollectSharedAssetParentCacheSyncPlan(tx, "about_assets", []int64{rowID})
		if err != nil {
			t.Fatal(err)
		}
		previewExec(t, tx, change, args...)
		plan, err = AddCurrentSharedAssetParents(tx, plan, []int64{rowID})
		if err != nil {
			t.Fatal(err)
		}
		if err := ResyncSharedAssetParentCache(tx, plan); err != nil {
			t.Fatal(err)
		}
	})
}

func applyAgain(t *testing.T, db *sql.DB, parentID int64) {
	t.Helper()
	gallery, err := dtt_card_picture.PictureRelationOf(db, "about")
	if err != nil || gallery == nil {
		t.Fatalf("gallery: %v %v", gallery, err)
	}
	before := cardPictureWrites(t, db, parentID)
	inTransaction(t, db, func(tx *sql.Tx) {
		if err := ApplyCardPictureRule(tx, "about", gallery, []int64{parentID}, nil); err != nil {
			t.Fatal(err)
		}
	})
	if after := cardPictureWrites(t, db, parentID); after != before {
		t.Fatalf("applying the rule again wrote the card picture %d more times, want none", after-before)
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
