// canonical.go
// Chooses downgrade-safe stored Home presentations from strict v2/v3 requests.
// Connects admin normalization and generic-row validation to one storage policy.
// Readers and browser requests continue to use the complete version-three value.
package front_page_presentation

import "encoding/json"

// CanonicalStored returns the bytes to store and whether the input already uses
// the canonical schema. A generic writer must refuse a false result instead of
// storing its original row. Inactive default-style timing values are discarded.
// No browser twin is needed: the admin response supplies the normalized v3 value.
func CanonicalStored(raw any) (data json.RawMessage, canonical bool, err error) {
	fields, err := presentationFields(raw)
	if err != nil {
		return nil, false, err
	}
	var version float64
	if err := json.Unmarshal(fields["schema_version"], &version); err != nil {
		return nil, false, err
	}
	var value Value
	if version == 2 {
		value, err = ParseStored(raw)
	} else {
		// Version one remains read-only; partial version-three requests are refused.
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
	if value.TextStyle.Preset == "default" && value.TextStyle.Reveal.Mode == "none" {
		storedVersion = 2
		fields["schema_version"] = json.RawMessage(`2`)
		delete(fields, "text_style")
	}
	data, err = json.Marshal(fields)
	return data, version == float64(storedVersion), err
}
