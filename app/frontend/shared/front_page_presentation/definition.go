// definition.go
// Validates Home presentation against the browser's embedded definition.
// Connects strict version-two writes and development version-one reads.
// Keeps conversion away from revision hashing and all persistence locks.
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
	Alignments       []string `json:"alignments"`
	HorizontalMargin Bounds   `json:"horizontal_margin_px"`
	VerticalMargin   Bounds   `json:"vertical_margin_px"`
	MaxWidth         Bounds   `json:"max_width_px"`
	LightWash        Bounds   `json:"light_wash"`
	LightOpacity     Bounds   `json:"light_opacity"`
	DarkWash         Bounds   `json:"dark_wash"`
	DarkOpacity      Bounds   `json:"dark_opacity"`
	Legacy           struct {
		SchemaVersion int               `json:"schema_version"`
		Alignments    map[string]string `json:"alignments"`
	} `json:"legacy"`
	Default Value `json:"default"`
}

// Value is the complete version-two layout and per-theme media treatment.
type Value struct {
	SchemaVersion      int    `json:"schema_version"`
	Anchor             string `json:"anchor"`
	HorizontalMarginPx int    `json:"horizontal_margin_px"`
	VerticalMarginPx   int    `json:"vertical_margin_px"`
	Alignment          string `json:"alignment"`
	MaxWidthPx         int    `json:"max_width_px"`
	LightWash          int    `json:"light_wash"`
	LightOpacity       int    `json:"light_opacity"`
	DarkWash           int    `json:"dark_wash"`
	DarkOpacity        int    `json:"dark_opacity"`
}

// Rules returns independent values so callers cannot alter the shared policy.
func Rules() Definition {
	var definition Definition
	if err := json.Unmarshal(source, &definition); err != nil {
		panic(err)
	}
	return definition
}

func presentationFields(raw any) (map[string]json.RawMessage, error) {
	var data []byte
	switch value := raw.(type) {
	case []byte:
		data = value
	case json.RawMessage:
		data = value
	case string:
		data = []byte(value)
	default:
		var err error
		data, err = json.Marshal(raw)
		if err != nil {
			return nil, err
		}
	}
	var fields map[string]json.RawMessage
	err := json.Unmarshal(data, &fields)
	return fields, err
}

// Parse refuses partial, unknown, null, coerced and off-step version-two writes.
// Its browser twin is validator.js:isValidHomePresentation.
func Parse(raw any) (Value, error) {
	fields, err := presentationFields(raw)
	if err != nil {
		return Value{}, err
	}
	rules := Rules()
	var value Value
	numbers := []struct {
		name   string
		bounds Bounds
		target *int
	}{
		{"schema_version", Bounds{rules.SchemaVersion, rules.SchemaVersion, 1}, &value.SchemaVersion},
		{"horizontal_margin_px", rules.HorizontalMargin, &value.HorizontalMarginPx},
		{"vertical_margin_px", rules.VerticalMargin, &value.VerticalMarginPx},
		{"max_width_px", rules.MaxWidth, &value.MaxWidthPx},
		{"light_wash", rules.LightWash, &value.LightWash},
		{"light_opacity", rules.LightOpacity, &value.LightOpacity},
		{"dark_wash", rules.DarkWash, &value.DarkWash},
		{"dark_opacity", rules.DarkOpacity, &value.DarkOpacity},
	}
	if len(fields) != len(numbers)+2 {
		return value, fmt.Errorf("Home presentation requires ten fields")
	}
	for _, name := range []string{"anchor", "alignment"} {
		if len(fields[name]) == 0 || string(fields[name]) == "null" {
			return value, fmt.Errorf("missing %s", name)
		}
	}
	if err := json.Unmarshal(fields["anchor"], &value.Anchor); err != nil {
		return value, err
	}
	if err := json.Unmarshal(fields["alignment"], &value.Alignment); err != nil {
		return value, err
	}
	if !slices.Contains(rules.Anchors, value.Anchor) || !slices.Contains(rules.Alignments, value.Alignment) {
		return value, fmt.Errorf("invalid Home presentation choice")
	}
	for _, number := range numbers {
		if len(fields[number.name]) == 0 || string(fields[number.name]) == "null" {
			return value, fmt.Errorf("missing %s", number.name)
		}
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

// ParseStored converts only complete development version-one rows; writes use Parse.
// Readers hash the original stored bytes, so conversion never invalidates a revision.
func ParseStored(raw any) (Value, error) {
	fields, err := presentationFields(raw)
	if err != nil {
		return Value{}, err
	}
	rules := Rules()
	var version float64
	if err := json.Unmarshal(fields["schema_version"], &version); err != nil {
		return Value{}, err
	}
	if version != float64(rules.Legacy.SchemaVersion) {
		return Parse(raw)
	}
	names := []string{"schema_version", "anchor", "margin_px", "paragraph_layout", "max_width_px"}
	if len(fields) != len(names) {
		return Value{}, fmt.Errorf("incomplete legacy Home presentation")
	}
	for _, name := range names {
		if len(fields[name]) == 0 || string(fields[name]) == "null" {
			return Value{}, fmt.Errorf("missing %s", name)
		}
	}
	var layout string
	if err := json.Unmarshal(fields["paragraph_layout"], &layout); err != nil {
		return Value{}, err
	}
	alignment, valid := rules.Legacy.Alignments[layout]
	if !valid {
		return Value{}, fmt.Errorf("invalid legacy Home alignment")
	}
	converted, _ := presentationFields(rules.Default)
	converted["anchor"] = fields["anchor"]
	converted["horizontal_margin_px"] = fields["margin_px"]
	converted["vertical_margin_px"] = fields["margin_px"]
	converted["alignment"], _ = json.Marshal(alignment)
	converted["max_width_px"] = fields["max_width_px"]
	return Parse(converted)
}
