// Proves the real upload writer owns its size hint and survives a rejected hint.
// Reuses the explicitly opted-in upload replay database, cleaned up at test end.
package dtt_1_row_create

import (
	"bytes"
	"encoding/json"
	"image"
	"image/jpeg"
	"mime/multipart"
	"net/http/httptest"
	"testing"

	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/media_utils"
)

func TestUploadDisplayedImageSizeMergeAndSavepointPostgres(t *testing.T) {
	for _, rejectSize := range []bool{false, true} {
		t.Run(map[bool]string{false: "stores_server_size", true: "size_rejection_keeps_upload"}[rejectSize], func(t *testing.T) {
			db := replayDisposableDB(t)
			paths := replayStorage(t)
			replayExec(t, db, `INSERT INTO system_about VALUES(4,NULL)`)
			if rejectSize {
				replayExec(t, db, `ALTER TABLE system_about_assets ALTER COLUMN metadata_json SET DEFAULT '{"caption":"keep"}';
 ALTER TABLE system_about_assets ADD CONSTRAINT reject_dimension_hint CHECK(NOT (metadata_json ? 'displayed_image_size'))`)
			} else {
				replayExec(t, db, `ALTER TABLE system_about_assets ALTER COLUMN metadata_json SET DEFAULT '{"caption":"keep","image_source":{"url":"keep"},"recovered_from":"keep","logo":true,"displayed_image_size":{"width_px":999,"height_px":999,"file":"client"}}'`)
			}
			id, file := replayUpload(t, db, paths.StorageRoot, 4)
			var stored, metadata []byte
			if err := db.QueryRow(`SELECT metadata_json, metadata_json-'displayed_image_size' FROM system_about_assets WHERE id=$1 AND filename=$2`, id, file).Scan(&stored, &metadata); err != nil {
				t.Fatal("upload was not saved", err)
			}
			var values map[string]interface{}
			if err := json.Unmarshal(stored, &values); err != nil {
				t.Fatal(err)
			}
			if values["caption"] != "keep" {
				t.Fatal("caption lost")
			}
			if rejectSize {
				if values[media_utils.DisplayedImageSizeKey] != nil {
					t.Fatal("rejected size persisted")
				}
			} else {
				var size media_utils.DisplayedImageSize
				raw, _ := json.Marshal(values[media_utils.DisplayedImageSizeKey])
				_ = json.Unmarshal(raw, &size)
				if size.WidthPx != 4 || size.HeightPx != 3 || size.File != file {
					t.Fatalf("client size survived: %+v", size)
				}
				if values["image_source"] == nil || values["recovered_from"] != "keep" || values["logo"] != true {
					t.Fatal("other keys lost")
				}
			}
		})
	}
}

func TestUploadJPEGOrientationStoredPostgres(t *testing.T) {
	db := replayDisposableDB(t)
	paths := replayStorage(t)
	replayExec(t, db, `INSERT INTO system_about VALUES(4,NULL)`)
	var jpegData bytes.Buffer
	if err := jpeg.Encode(&jpegData, image.NewRGBA(image.Rect(0, 0, 8, 3)), nil); err != nil {
		t.Fatal(err)
	}
	// Little-endian TIFF, one SHORT orientation tag, value 6 (90 degrees).
	exif := []byte{0xff, 0xe1, 0, 34, 'E', 'x', 'i', 'f', 0, 0, 'I', 'I', 42, 0, 8, 0, 0, 0, 1, 0, 0x12, 1, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0}
	data := append(append([]byte{0xff, 0xd8}, exif...), jpegData.Bytes()[2:]...)
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file_child_0", "phone.jpg")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write(data); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	form, err := multipart.NewReader(&body, writer.Boundary()).ReadForm(1 << 20)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = form.RemoveAll() })
	lt := dbutils.NewLazyTx(db)
	ctx := dbutils.SetLazyTx(t.Context(), lt)
	tx, err := lt.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer lt.Rollback()
	var id int64
	if err := tx.QueryRow(`INSERT INTO system_about_assets(system_about_id,asset_kind) VALUES(4,'image') RETURNING id`).Scan(&id); err != nil {
		t.Fatal(err)
	}
	if err := saveUploadedFiles(ctx, tx, httptest.NewRecorder(), form.File, paths.StorageRoot, "system_about_assets", "118", id, nil); err != nil {
		t.Fatal(err)
	}
	if err := lt.Commit(); err != nil {
		t.Fatal(err)
	}
	var width, height int
	if err := db.QueryRow(`SELECT (metadata_json->'displayed_image_size'->>'width_px')::int,(metadata_json->'displayed_image_size'->>'height_px')::int FROM system_about_assets WHERE id=$1`, id).Scan(&width, &height); err != nil {
		t.Fatal(err)
	}
	if width != 3 || height != 8 {
		t.Fatalf("oriented upload = %dx%d", width, height)
	}
}
