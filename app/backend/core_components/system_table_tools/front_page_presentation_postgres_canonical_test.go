// front_page_presentation_postgres_canonical_test.go
// Proves canonical JSON and a v2 restore through PostgreSQL's actual JSONB storage.
// Connects the existing disposable fixture, admin transaction and public reader.
// The native supervisor runs this opt-in proof before review; no live site is used.
package system_table_tools

import (
	"context"
	"encoding/json"
	"reflect"
	"testing"

	backend "easelect/backend/core_components"
	presentation "easelect/frontend/shared/front_page_presentation"
)

func TestHomePresentationPostgresCanonicalFormsAndRestore(t *testing.T) {
	db := frontPageDisposableDB(t)
	value := presentation.Rules().Default
	for _, tc := range []struct {
		preset, mode             string
		start, interval, version int
		phone                    string
		size                     int
	}{
		{"default", "none", 3000, 800, 2, "inherit", 15}, {"default", "none", 1234, 567, 2, "inherit", 15},
		{"serif_story_v1", "none", 1234, 567, 3, "inherit", 15}, {"default", "lines", 1234, 567, 3, "inherit", 15},
		{"default", "none", 3000, 800, 4, "start", 15}, {"serif_story_v1", "lines", 1234, 567, 4, "center", 15},
		{"serif_story_v1", "none", 3000, 800, 5, "inherit", 12}, {"serif_story_v1", "lines", 3000, 800, 5, "center", 18},
	} {
		_, current, err := backend.ReadFrontPagePresentation(context.Background(), db)
		if err != nil {
			t.Fatal(err)
		}
		value.TextStyle = presentation.TextStyle{Preset: tc.preset, Reveal: presentation.LineReveal{Mode: tc.mode, StartMS: tc.start, IntervalMS: tc.interval}}
		value.PhoneAlignment, value.PhoneStorySize = tc.phone, tc.size
		raw, _ := json.Marshal(value)
		revision, err := frontPageTestSave(db, frontPageAdminRequest{Presentation: raw, Version: current})
		if err != nil {
			t.Fatal(err)
		}
		var stored []byte
		var updated string
		if err := db.QueryRow(`SELECT json_value,updated::text FROM public.system_config WHERE key='front_page_presentation'`).Scan(&stored, &updated); err != nil {
			t.Fatal(err)
		}
		var fields map[string]any
		json.Unmarshal(stored, &fields)
		_, hasStyle := fields["text_style"]
		_, hasPhone := fields["phone_alignment"]
		if fields["schema_version"] != float64(tc.version) || hasStyle != (tc.version >= 3) || hasPhone != (tc.version >= 4) || (fields["phone_story_size"] != nil) != (tc.version == 5) || revision != backend.FrontPagePresentationRevision(stored, updated) {
			t.Fatal(string(stored), revision)
		}
	}
	// A v2 request has no text_style. Its v5 GET value restores exactly those ten fields.
	original := []byte(`{"schema_version":2,"anchor":"bottom-left","horizontal_margin_px":73,"vertical_margin_px":91,"alignment":"right","max_width_px":700,"light_wash":27,"light_opacity":61,"dark_wash":19,"dark_opacity":43}`)
	_, current, err := backend.ReadFrontPagePresentation(context.Background(), db)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := frontPageTestSave(db, frontPageAdminRequest{Presentation: original, Version: current}); err != nil {
		t.Fatal(err)
	}
	read, revision, err := backend.ReadFrontPagePresentation(context.Background(), db)
	if err != nil || read.SchemaVersion != 5 || read.TextStyle != presentation.Rules().Default.TextStyle {
		t.Fatal(read, err)
	}
	raw, _ := json.Marshal(read)
	if _, err := frontPageTestSave(db, frontPageAdminRequest{Presentation: raw, Version: revision}); err != nil {
		t.Fatal(err)
	}
	var stored []byte
	if err := db.QueryRow(`SELECT json_value FROM public.system_config WHERE key='front_page_presentation'`).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	var before, after map[string]any
	json.Unmarshal(original, &before)
	json.Unmarshal(stored, &after)
	if !reflect.DeepEqual(before, after) {
		t.Fatal("v2 restore changed original fields", before, after)
	}
}
