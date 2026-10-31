// Proves library uses copy only dimensions and isolate optional SQL failures.
package media_library

import (
	"encoding/json"
	"testing"
)

func TestLibraryImageDimensionsCopyAndFailureSafetyPostgres(t *testing.T) {
	db := disposableDB(t)
	if _, err := db.Exec(`CREATE TABLE size_sources(id integer PRIMARY KEY, metadata_json jsonb);
 INSERT INTO size_sources VALUES(1,'{"image_source":{"url":"private"},"caption":"source","displayed_image_size":{"width_px":7,"height_px":4,"file":"101_1_9.png"}}'),
 (2,'{"caption":"target"}'),(3,'{}'),(4,'[]');
 ALTER TABLE size_sources ADD CONSTRAINT reject_third_size CHECK(id<>3 OR NOT (metadata_json ? 'displayed_image_size'))`); err != nil {
		t.Fatal(err)
	}
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	copyImageSize(tx, "size_sources", 1, 2, "image.png")
	copyImageSize(tx, "size_sources", 1, 3, "image.png")
	copyImageSize(tx, "size_sources", 1, 4, "image.png")
	if err := tx.Commit(); err != nil {
		t.Fatal("optional size failure aborted attach", err)
	}
	var raw []byte
	if err := db.QueryRow(`SELECT metadata_json FROM size_sources WHERE id=2`).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	var metadata map[string]interface{}
	if err := json.Unmarshal(raw, &metadata); err != nil {
		t.Fatal(err)
	}
	if len(metadata) != 2 || metadata["caption"] != "target" || metadata["image_source"] != nil {
		t.Fatal("source provenance copied or target keys lost")
	}
	size := metadata["displayed_image_size"].(map[string]interface{})
	if size["file"] != "image.png" || size["width_px"] != float64(7) || size["height_px"] != float64(4) {
		t.Fatal("dimension copy is wrong")
	}
	var noSize, arrayKept bool
	if err := db.QueryRow(`SELECT NOT(metadata_json ? 'displayed_image_size') FROM size_sources WHERE id=3`).Scan(&noSize); err != nil || !noSize {
		t.Fatal("rejected size persisted", err)
	}
	if err := db.QueryRow(`SELECT metadata_json='[]'::jsonb FROM size_sources WHERE id=4`).Scan(&arrayKept); err != nil || !arrayKept {
		t.Fatal("non-object overwritten", err)
	}
}
