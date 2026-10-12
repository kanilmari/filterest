// card_picture_rule_helpers_test.go
// Provides the shared file probes and disposable PostgreSQL card-picture fixture.
// Between selection, alignment, and locking tests and their isolated storage and SQL state.
// Keeps fixture setup and writer-path helpers defined once for the whole test package.
package dtt_asset_linking

import (
	"database/sql"
	"easelect/backend/core_components/dynamic_table_tools/dtt_card_picture"
	media_utils "easelect/backend/core_components/media_utils"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
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
