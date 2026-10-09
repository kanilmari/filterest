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
		for _, layout := range rules.Alignments {
			for _, margin := range []int{0, 40, 320} {
				for _, width := range []int{320, 1120, 1600} {
					value := rules.Default
					value.Anchor, value.Alignment = anchor, layout
					value.HorizontalMarginPx, value.VerticalMarginPx, value.MaxWidthPx = margin, margin, width
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
	for _, key := range []string{"schema_version", "anchor", "horizontal_margin_px", "vertical_margin_px", "alignment", "max_width_px", "light_wash", "light_opacity", "dark_wash", "dark_opacity"} {
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
		{"schema_version", 1}, {"anchor", "left"}, {"alignment", "artistic"},
		{"horizontal_margin_px", -1}, {"horizontal_margin_px", 321}, {"horizontal_margin_px", 1.5}, {"horizontal_margin_px", "40"},
		{"max_width_px", 319}, {"max_width_px", 1601}, {"max_width_px", 321}, {"max_width_px", "1120"}, {"vertical_margin_px", 321}, {"light_wash", -1}, {"light_opacity", 101}, {"dark_wash", 1.5}, {"dark_opacity", "20"}, {"unknown", true},
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

func TestHomePresentationThemeBoundsAndStoredConversion(t *testing.T) {
	rules := Rules()
	for _, key := range []string{"light_wash", "light_opacity", "dark_wash", "dark_opacity"} {
		for _, number := range []int{0, 100} {
			fields, _ := presentationFields(rules.Default)
			fields[key], _ = json.Marshal(number)
			if _, err := Parse(fields); err != nil {
				t.Fatal(key, number, err)
			}
		}
	}
	for _, layout := range []string{"normal", "artistic"} {
		legacy := map[string]any{"schema_version": 1, "anchor": "bottom-right", "margin_px": 71,
			"paragraph_layout": layout, "max_width_px": 700}
		got, err := ParseStored(legacy)
		expected := rules.Default
		expected.Anchor, expected.HorizontalMarginPx, expected.VerticalMarginPx = "bottom-right", 71, 71
		expected.Alignment, expected.MaxWidthPx = rules.Legacy.Alignments[layout], 700
		if err != nil || got != expected {
			t.Fatal(got, expected, err)
		}
		if _, err := Parse(legacy); err == nil {
			t.Fatal("version-one write accepted")
		}
		for _, bad := range []any{nil, "71", 321, 1.5} {
			legacy["margin_px"] = bad
			if _, err := ParseStored(legacy); err == nil {
				t.Fatal("invalid conversion accepted", legacy)
			}
		}
	}
	for _, raw := range []string{`null`, `{}`, `[]`, `{"schema_version":1}`, `{"schema_version":null}`} {
		if _, err := ParseStored(raw); err == nil {
			t.Fatal("invalid stored layout", raw)
		}
	}
}

func TestHomePresentationStoredNumericVersionMatchesBrowserIntegers(t *testing.T) {
	legacy := `{"schema_version":1.0,"anchor":"top-left","margin_px":40,"paragraph_layout":"normal","max_width_px":1120}`
	if _, err := ParseStored(legacy); err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(Rules().Default)
	fields, _ := presentationFields(raw)
	fields["schema_version"] = json.RawMessage(`2.0`)
	if _, err := ParseStored(fields); err != nil {
		t.Fatal(err)
	}
}
