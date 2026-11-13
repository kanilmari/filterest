// Exercises compatibility with pre-field site settings and the sparse storage format.
package dataset_appearance_store

import (
	"encoding/json"
	"testing"
)

func TestRowPresentationSiteStorage(t *testing.T) {
	const path = "shared.row_article_default_presentation"
	for _, mode := range []string{"article_view", "image_first_view", "image_first_page_view"} {
		site := DefaultSiteAppearanceValues()
		site.Defaults[path] = mode
		site.Defaults["shared.card_detail_columns"] = 4
		raw, err := json.Marshal(site)
		if err != nil {
			t.Fatal(err)
		}
		var stored struct{ Defaults map[string]any }
		if err := json.Unmarshal(raw, &stored); err != nil {
			t.Fatal(err)
		}
		got, present := stored.Defaults[path]
		if mode == "article_view" && present || mode != "article_view" && (!present || got != mode) {
			t.Fatalf("%s saved as %v, present=%t", mode, got, present)
		}
		if site.Defaults[path] != mode {
			t.Fatal("writer changed the caller's complete map")
		}
		decoded, err := DecodeSiteAppearance(raw, false)
		if err != nil || decoded.Shared.RowArticleDefaultPresentation != mode || decoded.Shared.CardDetailColumns != 4 {
			t.Fatalf("readback %s: %+v, err=%v", mode, decoded.Shared, err)
		}
	}
}

func TestRowPresentationProjectionPreservesPermissionsRevisionsAndOtherOverrides(t *testing.T) {
	snapshot := AppearanceResponse{DatasetUID: 91, SchemaVersion: 2, Version: "5", SharedVersion: "shared-1",
		Defaults:  map[string]any{RowPresentationPath: "image_first_page_view", "shared.card_show_all_fields": true},
		Overrides: map[string]any{RowPresentationPath: "article_view", "shared.card_show_all_fields": false},
		Sources:   map[string]string{RowPresentationPath: "override", "shared.card_show_all_fields": "override"}}
	snapshot.Effective.Shared.RowArticleDefaultPresentation = "article_view"
	legacy := snapshot.ForClient(LegacyAppearance)
	if _, ok := legacy.Defaults[RowPresentationPath]; ok {
		t.Fatal("unexpected legacy default")
	}
	if _, ok := legacy.Overrides[RowPresentationPath]; ok {
		t.Fatal("unexpected legacy override")
	}
	if _, ok := legacy.Sources[RowPresentationPath]; ok {
		t.Fatal("unexpected legacy source")
	}
	if legacy.Overrides["shared.card_show_all_fields"] != false || legacy.Version != snapshot.Version || legacy.SharedVersion != snapshot.SharedVersion || legacy.DatasetUID != snapshot.DatasetUID {
		t.Fatal(legacy)
	}
	raw, err := json.Marshal(legacy.Effective.Shared)
	if err != nil {
		t.Fatal(err)
	}
	var nested map[string]any
	if err = json.Unmarshal(raw, &nested); err != nil {
		t.Fatal(err)
	}
	if _, ok := nested["row_article_default_presentation"]; ok {
		t.Fatal("legacy projection exposed the new field")
	}
	if snapshot.ForClient(RowPresentationAppearance).Overrides[RowPresentationPath] != "article_view" || snapshot.Defaults[RowPresentationPath] != "image_first_page_view" || snapshot.Sources[RowPresentationPath] != "override" {
		t.Fatal("legacy projection mutated shared data")
	}
}
