// dataset_presentation_media_test.go
// Checks that dataset results carry hidden flags without discarding media links.
// Connects the presentation reader with an isolated PostgreSQL media registry.
// Guards role-specific aggregation and the no-media false defaults.
package dtt_1_row_read

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestDatasetPresentationMediaHiddenJSON(t *testing.T) {
	body, err := json.Marshal(DatasetPresentationMedia{CoverImagePath: "/storage/cover.svg", BackgroundImagePath: "/storage/background.svg", CoverImageHidden: true, BackgroundImageHidden: false})
	if err != nil {
		t.Fatal(err)
	}
	for _, fragment := range []string{`"cover_image_path":"/storage/cover.svg"`, `"cover_image_hidden":true`, `"background_image_path":"/storage/background.svg"`, `"background_image_hidden":false`} {
		if !strings.Contains(string(body), fragment) {
			t.Fatalf("missing %s: %s", fragment, body)
		}
	}
}

func TestDatasetPresentationMediaHiddenPostgres(t *testing.T) {
	db := relatedCardPicturePostgres(t)
	if _, err := db.Exec(`CREATE TABLE system_dataset_media (table_uid bigint, media_role text, storage_key text, hidden boolean NOT NULL DEFAULT false);
        INSERT INTO system_dataset_media VALUES (300, 'cover', '300/dataset_media/cover/original/cover.svg', false),
        (300, 'background', '300/dataset_media/background/original/background.svg', false);`); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct{ cover, background bool }{{false, false}, {true, false}, {false, true}, {true, true}} {
		if _, err := db.Exec(`UPDATE system_dataset_media SET hidden=CASE WHEN media_role='cover' THEN $1::boolean ELSE $2::boolean END`, tc.cover, tc.background); err != nil {
			t.Fatal(err)
		}
		media, err := fetchDatasetPresentationMedia(db, "brands")
		if err != nil {
			t.Fatal(err)
		}
		if media.CoverImageHidden != tc.cover || media.BackgroundImageHidden != tc.background || media.CoverImagePath != "/storage/300/dataset_media/cover/original/cover.svg" || media.BackgroundImagePath != "/storage/300/dataset_media/background/original/background.svg" {
			t.Fatalf("flags %+v: %+v", tc, media)
		}
	}
	media, err := fetchDatasetPresentationMedia(db, "notes")
	if err != nil {
		t.Fatal(err)
	}
	if media != (DatasetPresentationMedia{}) {
		t.Fatalf("empty media=%+v", media)
	}
}
