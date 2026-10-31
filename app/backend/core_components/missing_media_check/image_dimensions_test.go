// Covers count-only responses, strict references and skip accounting without SQL.
package missing_media_check

import (
	"bytes"
	"context"
	"encoding/json"
	"image"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"easelect/backend/core_components/dbutils"
)

func dimensionPNG(t *testing.T, root, relative string) {
	t.Helper()
	var data bytes.Buffer
	if err := png.Encode(&data, image.NewRGBA(image.Rect(0, 0, 7, 4))); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(root, relative)
	if err := os.MkdirAll(filepath.Dir(file), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(file, data.Bytes(), 0600); err != nil {
		t.Fatal(err)
	}
}

func TestDimensionRowsCountSkipsAndPreserveUnknownReferences(t *testing.T) {
	root := t.TempDir()
	target := dimensionGallery{relationTarget: relationTarget{ParentTableUID: "117", AssetTable: "pictures", FilenameColumn: "filename"}}
	dimensionPNG(t, root, "117/1/1000/photo.png")
	cases := []struct{ name, reference, metadata, counter string }{
		{"missing", "missing.png", "{}", "skipped_no_file"},
		{"empty", "", "{}", "skipped_no_file"},
		{"map", `{"fi":"photo.png"}`, "{}", "skipped_unresolved_reference"},
		{"external", "https://elsewhere/photo.png", "{}", "skipped_unresolved_reference"},
		{"suffix", "photo.png?size=1000", "{}", "skipped_unresolved_reference"},
		{"array", "photo.png", "[]", "skipped_non_object_metadata"},
		{"null", "photo.png", "null", "skipped_non_object_metadata"},
		{"scalar", "photo.png", `"caption"`, "skipped_non_object_metadata"},
		{"already", "photo.png", `{"displayed_image_size":{"file":"photo.png","height_px":4,"width_px":7},"caption":"kept"}`, "already_sized"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			counts := ImageDimensionsCounts{}
			_, ok := measureDimensionRow(root, target, dimensionRow{id: 1, parentID: 1, reference: c.reference, metadata: []byte(c.metadata)}, &counts)
			if ok {
				t.Fatal("skip produced a write")
			}
			raw, _ := json.Marshal(counts)
			var fields map[string]int
			_ = json.Unmarshal(raw, &fields)
			if fields[c.counter] != 1 {
				t.Fatalf("counts: %s", raw)
			}
		})
	}
	for _, metadata := range [][]byte{nil, []byte(`{"caption":"keep","displayed_image_size":{"file":"stale.png","width_px":7,"height_px":4}}`)} {
		counts := ImageDimensionsCounts{}
		write, ok := measureDimensionRow(root, target, dimensionRow{id: 1, parentID: 1, reference: "photo.png", metadata: metadata}, &counts)
		if !ok || strings.Contains(string(write.patch), "caption") {
			t.Fatal("new size patch is wrong")
		}
	}
}

func TestDimensionEndpointRejectsNonAdministratorAndInvalidInput(t *testing.T) {
	for _, role := range []string{"guest", "basic", "readonly"} {
		request := httptest.NewRequest(http.MethodPost, "/api/admin/image-dimensions-backfill", strings.NewReader(`{}`))
		request = request.WithContext(dbutils.SetRequestActorContext(context.Background(), dbutils.NewRequestActorContext(2, role)))
		response := httptest.NewRecorder()
		AdminImageDimensionsBackfillHandler(response, request)
		if response.Code != http.StatusForbidden {
			t.Fatalf("%s got %d", role, response.Code)
		}
	}
	for _, body := range []string{`{"max_rows":0}`, `{"max_rows":1001}`, `{"max_rows":-1}`, `{"dry_run":"false"}`, `{} {}`, `{"filename":"private.png"}`} {
		request := httptest.NewRequest(http.MethodPost, "/api/admin/image-dimensions-backfill", strings.NewReader(body))
		request = request.WithContext(dbutils.SetRequestActorContext(context.Background(), dbutils.NewRequestActorContext(2, "admin")))
		response := httptest.NewRecorder()
		AdminImageDimensionsBackfillHandler(response, request)
		if response.Code != http.StatusBadRequest || strings.Contains(response.Body.String(), "private.png") {
			t.Fatalf("invalid input got %d", response.Code)
		}
	}
}

func TestDimensionDryRunStillCountsOriginalOrientation(t *testing.T) {
	root := t.TempDir()
	dimensionPNG(t, root, "117/1/1000/photo.jpg")
	dir := filepath.Join(root, "117/1/original")
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	// A bounded original-header probe does not decode its pixel stream.
	exif := []byte{0xff, 0xd8, 0xff, 0xe1, 0, 34, 'E', 'x', 'i', 'f', 0, 0, 'I', 'I', 42, 0, 8, 0, 0, 0, 1, 0, 0x12, 1, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0}
	if err := os.WriteFile(filepath.Join(dir, "photo.jpg"), exif, 0600); err != nil {
		t.Fatal(err)
	}
	counts := ImageDimensionsCounts{}
	_, ok := measureDimensionRow(root, dimensionGallery{relationTarget: relationTarget{ParentTableUID: "117"}}, dimensionRow{id: 1, parentID: 1, reference: "photo.jpg"}, &counts)
	if !ok || counts.OriginalsRotatedByTag != 1 {
		t.Fatalf("original EXIF count: %+v", counts)
	}
}
