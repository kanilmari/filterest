// canonical.go
// Chooses downgrade-safe stored Home presentations from complete v2 through v7 requests.
// Connects admin normalization and generic-row validation to one storage policy.
// Only nondefault row spacing needs v7 storage.
package front_page_presentation

import "encoding/json"

// CanonicalStored returns the bytes to store and whether the input already uses
// the canonical schema. A generic writer must refuse a false result instead of
// storing its original row. Inactive default-style timings are discarded in v2.
// No browser twin is needed: the admin response supplies the normalized current value.
func CanonicalStored(raw any) (data json.RawMessage, canonical bool, err error) {
	fields, err := presentationFields(raw)
	if err != nil {
		return nil, false, err
	}
	var version float64
	if err := json.Unmarshal(fields["schema_version"], &version); err != nil {
		return nil, false, err
	}
	rules := Rules()
	var value Value
	if version >= 2 && version < float64(rules.SchemaVersion) {
		value, err = ParseStored(raw)
	} else {
		// Version one remains read-only; partial current requests are refused.
		value, err = Parse(raw)
	}
	if err != nil {
		return nil, false, err
	}
	fields, err = presentationFields(value)
	if err != nil {
		return nil, false, err
	}
	storedVersion := value.SchemaVersion
	defaults := rules.Default
	if value.BoxRowGapPx == defaults.BoxRowGapPx {
		storedVersion = 6
		delete(fields, "box_row_gap_px")
	}
	if storedVersion == 6 && value.BoxHeadingGapPx == defaults.BoxHeadingGapPx {
		storedVersion = 5
		delete(fields, "box_heading_gap_px")
	}
	if storedVersion == 5 && value.PhoneStorySize == defaults.PhoneStorySize {
		storedVersion = 4
		delete(fields, "phone_story_size")
	}
	if storedVersion == 4 && value.PhoneAlignment == "inherit" {
		storedVersion = 3
		delete(fields, "phone_alignment")
		switch value.Alignment {
		case "start":
			fields["alignment"] = json.RawMessage(`"left"`)
		case "end":
			fields["alignment"] = json.RawMessage(`"right"`)
		}
		if value.TextStyle.Preset == "default" && value.TextStyle.Reveal.Mode == "none" {
			storedVersion = 2
			delete(fields, "text_style")
		}
	}
	fields["schema_version"], _ = json.Marshal(storedVersion)
	data, err = json.Marshal(fields)
	return data, version == float64(storedVersion), err
}
