// definition_test.go
// Exercises the server side of the shared Home presentation policy.
// Connects strict parsing with the browser's enums, bounds and field-presence cases.
// Refuses partial, coerced and unknown layout data before any write.
package front_page_presentation

import (
	"encoding/json"
	"testing"
)

func TestHomePresentationValidAndInvalid(t *testing.T) {
	rules := Rules()
	for _, anchor := range rules.Anchors {
		for _, layout := range rules.ParagraphLayouts {
			for _, margin := range []int{0, 40, 320} {
				for _, width := range []int{320, 1120, 1600} {
					value := Value{rules.SchemaVersion, anchor, margin, layout, width}
					got, err := Parse(value)
					if err != nil || got != value {
						t.Fatal(value, got, err)
					}
				}
			}
		}
	}
	data, _ := json.Marshal(rules.Default)
	var defaults map[string]any
	json.Unmarshal(data, &defaults)
	for _, key := range []string{"schema_version", "anchor", "margin_px", "paragraph_layout", "max_width_px"} {
		for _, missing := range []bool{false, true} {
			fields := map[string]any{}
			for k, v := range defaults {
				fields[k] = v
			}
			if missing {
				delete(fields, key)
			} else {
				fields[key] = nil
			}
			if _, err := Parse(fields); err == nil {
				t.Fatal("missing/null accepted", fields)
			}
		}
	}
	for _, change := range []struct {
		key   string
		value any
	}{
		{"schema_version", 2}, {"anchor", "left"}, {"paragraph_layout", "center"},
		{"margin_px", -1}, {"margin_px", 321}, {"margin_px", 1.5}, {"margin_px", "40"},
		{"max_width_px", 319}, {"max_width_px", 1601}, {"max_width_px", 321}, {"max_width_px", "1120"}, {"unknown", true},
	} {
		fields := map[string]any{}
		for k, v := range defaults {
			fields[k] = v
		}
		fields[change.key] = change.value
		if _, err := Parse(fields); err == nil {
			t.Fatal("accepted", fields)
		}
	}
	for _, raw := range []string{`null`, `{}`, `[]`, `false`, `{"margin_px":0}`} {
		if _, err := Parse(raw); err == nil {
			t.Fatal("accepted", raw)
		}
	}
}
