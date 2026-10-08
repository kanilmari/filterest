// definition.go
// Validates the Home layout from the same immutable definition as the browser.
// Connects strict API and generic settings writes to enums, integer bounds and steps.
// Keeps missing settings distinct from an intentionally saved layout.
package front_page_presentation

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"math"
	"slices"
)

//go:embed definition.json
var source []byte

type Bounds struct {
	Min  int `json:"min"`
	Max  int `json:"max"`
	Step int `json:"step"`
}
type Definition struct {
	SchemaVersion    int      `json:"schema_version"`
	Anchors          []string `json:"anchors"`
	ParagraphLayouts []string `json:"paragraph_layouts"`
	Margin           Bounds   `json:"margin_px"`
	MaxWidth         Bounds   `json:"max_width_px"`
	Default          Value    `json:"default"`
}

// Value is the complete stored layout; nil at the reader boundary means legacy.
type Value struct {
	SchemaVersion   int    `json:"schema_version"`
	Anchor          string `json:"anchor"`
	MarginPx        int    `json:"margin_px"`
	ParagraphLayout string `json:"paragraph_layout"`
	MaxWidthPx      int    `json:"max_width_px"`
}

// Rules returns independent values; callers cannot change the embedded policy.
func Rules() Definition {
	var definition Definition
	if err := json.Unmarshal(source, &definition); err != nil {
		panic(err)
	}
	return definition
}

// Parse refuses missing/unknown fields, coercion, null and off-step numeric values.
// The twin implementation is frontend/shared/front_page_presentation/validator.js.
func Parse(raw any) (Value, error) {
	var data []byte
	switch v := raw.(type) {
	case []byte:
		data = v
	case json.RawMessage:
		data = v
	case string:
		data = []byte(v)
	default:
		var err error
		data, err = json.Marshal(raw)
		if err != nil {
			return Value{}, err
		}
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return Value{}, err
	}
	names := []string{"schema_version", "anchor", "margin_px", "paragraph_layout", "max_width_px"}
	if len(fields) != len(names) {
		return Value{}, fmt.Errorf("Home layout requires five fields")
	}
	for _, name := range names {
		if len(fields[name]) == 0 || string(fields[name]) == "null" {
			return Value{}, fmt.Errorf("missing %s", name)
		}
	}
	rules := Rules()
	var value Value
	if err := json.Unmarshal(fields["anchor"], &value.Anchor); err != nil {
		return value, err
	}
	if err := json.Unmarshal(fields["paragraph_layout"], &value.ParagraphLayout); err != nil {
		return value, err
	}
	if !slices.Contains(rules.Anchors, value.Anchor) || !slices.Contains(rules.ParagraphLayouts, value.ParagraphLayout) {
		return value, fmt.Errorf("invalid Home layout choice")
	}
	for _, number := range []struct {
		name   string
		bounds Bounds
		target *int
	}{
		{"schema_version", Bounds{rules.SchemaVersion, rules.SchemaVersion, 1}, &value.SchemaVersion},
		{"margin_px", rules.Margin, &value.MarginPx}, {"max_width_px", rules.MaxWidth, &value.MaxWidthPx},
	} {
		var n float64
		if err := json.Unmarshal(fields[number.name], &n); err != nil {
			return value, err
		}
		if math.Trunc(n) != n || n < float64(number.bounds.Min) || n > float64(number.bounds.Max) ||
			math.Mod(n-float64(number.bounds.Min), float64(number.bounds.Step)) != 0 {
			return value, fmt.Errorf("invalid %s", number.name)
		}
		*number.target = int(n)
	}
	return value, nil
}
