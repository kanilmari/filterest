// definition.go
// Validates Home presentation against the browser's embedded definition.
// Connects the current settings to their stored predecessors.
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
	Min  float64 `json:"min"`
	Max  float64 `json:"max"`
	Step float64 `json:"step"`
}

// readNumber enforces each declared step in tenths, the smallest supported unit.
// Scaling the operands before subtraction preserves e.g. 9.7 - 9.6 as one step.
func (b Bounds) readNumber(fields map[string]json.RawMessage, name string) (float64, error) {
	var n float64
	raw := fields[name]
	if len(raw) == 0 || string(raw) == "null" || json.Unmarshal(raw, &n) != nil ||
		n < b.Min || n > b.Max || math.Round(n*10)/10 != n || math.Mod(n*10-b.Min*10, b.Step*10) != 0 {
		return 0, fmt.Errorf("invalid %s", name)
	}
	return n, nil
}

type Definition struct {
	SchemaVersion    int      `json:"schema_version"`
	Anchors          []string `json:"anchors"`
	Alignments       []string `json:"alignments"`
	PhoneAlignments  []string `json:"phone_alignments"`
	PhoneStorySize   Bounds   `json:"phone_story_size"`
	HorizontalMargin Bounds   `json:"horizontal_margin_px"`
	BoxRowGap        Bounds   `json:"box_row_gap_px"`
	BoxHeadingGap    Bounds   `json:"box_heading_gap_px"`
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
	TextStyle struct {
		Presets     []string `json:"presets"`
		RevealModes []string `json:"reveal_modes"`
		StartMS     Bounds   `json:"start_ms"`
		IntervalMS  Bounds   `json:"interval_ms"`
	} `json:"text_style"`
	Default Value `json:"default"`
}

// TextStyle selects bundled typography and a bounded, CSS-owned line reveal.
type TextStyle struct {
	Preset string     `json:"preset"`
	Reveal LineReveal `json:"reveal"`
}

// UsesSerifStoryTitle reports whether the slogan is a title accent, not a description.
// Mirrors front_page_text_style_renderer.js; none hides only the introduction.
func UsesSerifStoryTitle(preset string) bool {
	return preset == "serif_story_v1" || preset == "none"
}

type LineReveal struct {
	Mode       string `json:"mode"`
	StartMS    int    `json:"start_ms"`
	IntervalMS int    `json:"interval_ms"`
}

// Value is the complete Home layout, box spacing, phone typography, media and text style.
type Value struct {
	SchemaVersion      int       `json:"schema_version"`
	Anchor             string    `json:"anchor"`
	HorizontalMarginPx int       `json:"horizontal_margin_px"`
	VerticalMarginPx   int       `json:"vertical_margin_px"`
	BoxRowGapPx        float64   `json:"box_row_gap_px"`
	BoxHeadingGapPx    int       `json:"box_heading_gap_px"`
	Alignment          string    `json:"alignment"`
	PhoneAlignment     string    `json:"phone_alignment"`
	PhoneStorySize     int       `json:"phone_story_size"`
	MaxWidthPx         int       `json:"max_width_px"`
	LightWash          int       `json:"light_wash"`
	LightOpacity       int       `json:"light_opacity"`
	DarkWash           int       `json:"dark_wash"`
	DarkOpacity        int       `json:"dark_opacity"`
	TextStyle          TextStyle `json:"text_style"`
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

// Parse refuses partial, unknown, null, coerced and off-step current-version writes.
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
		{"schema_version", Bounds{float64(rules.SchemaVersion), float64(rules.SchemaVersion), 1}, &value.SchemaVersion},
		{"horizontal_margin_px", rules.HorizontalMargin, &value.HorizontalMarginPx},
		{"vertical_margin_px", rules.VerticalMargin, &value.VerticalMarginPx},
		{"box_heading_gap_px", rules.BoxHeadingGap, &value.BoxHeadingGapPx},
		{"phone_story_size", rules.PhoneStorySize, &value.PhoneStorySize},
		{"max_width_px", rules.MaxWidth, &value.MaxWidthPx},
		{"light_wash", rules.LightWash, &value.LightWash},
		{"light_opacity", rules.LightOpacity, &value.LightOpacity},
		{"dark_wash", rules.DarkWash, &value.DarkWash},
		{"dark_opacity", rules.DarkOpacity, &value.DarkOpacity},
	}
	if len(fields) != len(numbers)+5 {
		return value, fmt.Errorf("Home presentation requires %d fields", len(numbers)+5)
	}
	for _, name := range []string{"anchor", "alignment", "phone_alignment"} {
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
	if err := json.Unmarshal(fields["phone_alignment"], &value.PhoneAlignment); err != nil {
		return value, err
	}
	if !slices.Contains(rules.Anchors, value.Anchor) || !slices.Contains(rules.Alignments, value.Alignment) ||
		!slices.Contains(rules.PhoneAlignments, value.PhoneAlignment) {
		return value, fmt.Errorf("invalid Home presentation choice")
	}
	for _, number := range numbers {
		n, err := number.bounds.readNumber(fields, number.name)
		if err != nil {
			return value, err
		}
		*number.target = int(n)
	}
	value.BoxRowGapPx, err = rules.BoxRowGap.readNumber(fields, "box_row_gap_px")
	if err != nil {
		return value, err
	}
	value.TextStyle, err = parseTextStyle(fields["text_style"], rules)
	return value, err
}

// parseTextStyle mirrors validator.js:isValidHomeTextStyle, including exact nested keys.
func parseTextStyle(raw json.RawMessage, rules Definition) (TextStyle, error) {
	var value TextStyle
	fields, err := presentationFields(raw)
	if err != nil || len(fields) != 2 || fields["preset"] == nil || fields["reveal"] == nil {
		return value, fmt.Errorf("invalid Home text style fields")
	}
	if err := json.Unmarshal(fields["preset"], &value.Preset); err != nil || !slices.Contains(rules.TextStyle.Presets, value.Preset) {
		return value, fmt.Errorf("invalid Home text style preset")
	}
	reveal, err := presentationFields(fields["reveal"])
	if err != nil || len(reveal) != 3 || reveal["mode"] == nil {
		return value, fmt.Errorf("invalid Home reveal fields")
	}
	if err := json.Unmarshal(reveal["mode"], &value.Reveal.Mode); err != nil || !slices.Contains(rules.TextStyle.RevealModes, value.Reveal.Mode) {
		return value, fmt.Errorf("invalid Home reveal mode")
	}
	for _, field := range []struct {
		name   string
		bounds Bounds
		target *int
	}{
		{"start_ms", rules.TextStyle.StartMS, &value.Reveal.StartMS},
		{"interval_ms", rules.TextStyle.IntervalMS, &value.Reveal.IntervalMS},
	} {
		n, err := field.bounds.readNumber(reveal, field.name)
		if err != nil {
			return value, err
		}
		*field.target = int(n)
	}
	return value, nil
}

// ParseStored converts complete version-one through six rows; writes use CanonicalStored.
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
	if version == 2 || version == 3 {
		if len(fields) != int(version)+8 || fields["phone_alignment"] != nil || fields["phone_story_size"] != nil {
			return Value{}, fmt.Errorf("invalid legacy Home presentation fields")
		}
		var alignment string
		if err := json.Unmarshal(fields["alignment"], &alignment); err != nil {
			return Value{}, err
		}
		switch alignment {
		case "left":
			alignment = "start"
		case "right":
			alignment = "end"
		case "center", "justify":
		default:
			return Value{}, fmt.Errorf("invalid legacy Home alignment")
		}
		fields["alignment"], _ = json.Marshal(alignment)
		fields["phone_alignment"] = json.RawMessage(`"inherit"`)
		fields["phone_story_size"], _ = json.Marshal(rules.Default.PhoneStorySize)
		if version == 2 {
			if fields["text_style"] != nil {
				return Value{}, fmt.Errorf("version-two Home presentation forbids text_style")
			}
			fields["text_style"], _ = json.Marshal(rules.Default.TextStyle)
		}
		version = 5
	}
	if version == 4 {
		if len(fields) != 12 || fields["phone_story_size"] != nil {
			return Value{}, fmt.Errorf("invalid version-four Home presentation fields")
		}
		fields["phone_story_size"], _ = json.Marshal(rules.Default.PhoneStorySize)
		version = 5
	}
	if version == 5 {
		if len(fields) != 13 || fields["box_heading_gap_px"] != nil {
			return Value{}, fmt.Errorf("invalid version-five Home presentation fields")
		}
		fields["box_heading_gap_px"], _ = json.Marshal(rules.Default.BoxHeadingGapPx)
		version = 6
	}
	if version == 6 {
		if len(fields) != 14 || fields["box_row_gap_px"] != nil {
			return Value{}, fmt.Errorf("invalid version-six Home presentation fields")
		}
		fields["schema_version"], _ = json.Marshal(rules.SchemaVersion)
		fields["box_row_gap_px"], _ = json.Marshal(rules.Default.BoxRowGapPx)
		return Parse(fields)
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
