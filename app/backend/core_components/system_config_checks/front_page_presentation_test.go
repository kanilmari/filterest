// front_page_presentation_test.go
// Verifies every generic settings writer applies the Home layout policy.
// Connects JSON value-type enforcement with the shared presentation parser.
// Prevents CSV and row edits bypassing the dedicated Home palette's validation.
package system_config_checks

import (
	"encoding/json"
	"testing"

	presentation "easelect/frontend/shared/front_page_presentation"
)

func TestHomePresentationGenericWriteValidation(t *testing.T) {
	validate := func(kind int, value any) error {
		return ValidateRow("system_config", map[string]any{
			"key": "front_page_presentation", "value_type": kind, "json_value": value,
		})
	}
	for _, tc := range []struct {
		name, preset, phoneAlignment  string
		phoneSize, gap, storedVersion int
		rowGap                        float64
	}{
		{"default", "default", "inherit", 15, 8, 2, 9.6},
		{"styled text", "serif_story_v1", "inherit", 15, 8, 3, 9.6},
		{"phone alignment", "default", "center", 15, 8, 4, 9.6},
		{"phone size", "default", "center", 16, 8, 5, 9.6},
		{"heading gap", "default", "center", 16, 21, 6, 9.6},
		{"row gap", "default", "inherit", 15, 8, 7, 19.3},
	} {
		t.Run(tc.name, func(t *testing.T) {
			value := presentation.Rules().Default
			value.TextStyle.Preset, value.PhoneAlignment = tc.preset, tc.phoneAlignment
			value.PhoneStorySize, value.BoxHeadingGapPx, value.BoxRowGapPx = tc.phoneSize, tc.gap, tc.rowGap

			stored, _, err := presentation.CanonicalStored(value)
			if err != nil {
				t.Fatal(err)
			}
			var wire presentation.Value
			if err := json.Unmarshal(stored, &wire); err != nil || wire.SchemaVersion != tc.storedVersion {
				t.Fatalf("stored version = %d, want %d: %v", wire.SchemaVersion, tc.storedVersion, err)
			}
			if err := validate(5, stored); err != nil {
				t.Fatalf("generic JSON write rejected canonical v%d: %v", tc.storedVersion, err)
			}
			if err := validate(2, stored); err == nil {
				t.Fatal("accepted a Home layout with boolean value type")
			}
			if err := validate(5, value); (err == nil) != (tc.storedVersion == value.SchemaVersion) {
				t.Fatalf("generic write of expanded v%d, canonical v%d: %v", value.SchemaVersion, tc.storedVersion, err)
			}
			if got, err := presentation.ParseStored(stored); err != nil || got != value {
				t.Fatalf("reading stored v%d: got %+v, want %+v: %v", tc.storedVersion, got, value, err)
			}
		})
	}
	for _, value := range []any{nil, `{"anchor":"top-left"}`, `[]`} {
		if err := validate(5, value); err == nil {
			t.Fatalf("accepted incomplete Home layout: %v", value)
		}
	}
}
