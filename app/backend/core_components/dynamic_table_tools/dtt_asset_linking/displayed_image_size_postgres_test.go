// Keeps adopted preview provenance when dimensions are stored or rejected.
package dtt_asset_linking

import (
	"bytes"
	"encoding/json"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"testing"

	"easelect/backend/core_components/dynamic_table_tools/dtt_card_picture"
	"easelect/backend/core_components/runtimepaths"
)

func TestAdoptedImageDimensionsPreserveRecoveryAndFailureSafetyPostgres(t *testing.T) {
	for _, reject := range []bool{false, true} {
		t.Run(map[bool]string{false: "merge", true: "optional_write_rejected"}[reject], func(t *testing.T) {
			db := previewTestDB(t)
			seedPreviewFixture(t, db)
			if _, err := db.Exec(`INSERT INTO about VALUES(4,NULL)`); err != nil {
				t.Fatal(err)
			}
			if reject {
				if _, err := db.Exec(`ALTER TABLE about_assets ADD CONSTRAINT reject_size CHECK(NOT (metadata_json ? 'displayed_image_size'))`); err != nil {
					t.Fatal(err)
				}
			}
			original := runtimepaths.Current()
			t.Cleanup(func() { _ = runtimepaths.Configure(original) })
			installation := t.TempDir()
			paths, err := runtimepaths.Resolve(filepath.Join(installation, "app"), installation, true)
			if err != nil {
				t.Fatal(err)
			}
			if err := runtimepaths.Configure(paths); err != nil {
				t.Fatal(err)
			}
			dir := filepath.Join(paths.StorageRoot, "117/4/1000")
			if err := os.MkdirAll(dir, 0700); err != nil {
				t.Fatal(err)
			}
			var data bytes.Buffer
			if err := png.Encode(&data, image.NewRGBA(image.Rect(0, 0, 9, 4))); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(dir, "117_4_9.png"), data.Bytes(), 0600); err != nil {
				t.Fatal(err)
			}
			tx, err := db.Begin()
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback()
			id, err := InsertAdoptedCardImage(tx, &dtt_card_picture.PictureRelation{ChildTable: "about_assets", ForeignKey: "about_id", FilenameColumn: "filename"}, 4, "117_4_9.png", "cached_image")
			if err != nil {
				t.Fatal(err)
			}
			if err := tx.Commit(); err != nil {
				t.Fatal("optional write aborted adoption", err)
			}
			var raw []byte
			if err := db.QueryRow(`SELECT metadata_json FROM about_assets WHERE id=$1`, id).Scan(&raw); err != nil {
				t.Fatal(err)
			}
			var metadata map[string]interface{}
			if err := json.Unmarshal(raw, &metadata); err != nil {
				t.Fatal(err)
			}
			if metadata["recovered_from"] != "cached_image" {
				t.Fatal("recovered_from lost")
			}
			size, exists := metadata["displayed_image_size"]
			if exists == reject {
				t.Fatal("size persistence differs")
			}
			if exists && size.(map[string]interface{})["width_px"] != float64(9) {
				t.Fatal("wrong displayed size")
			}
		})
	}
}
