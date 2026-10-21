// home_text_style_test.go
// Applies the shared v4 fixture to the generic configuration write boundary.
// Connects nested invalid cases and canonical v2/v3/v4 storage to ValidateRow.
// Prevents a generic editor bypassing the palette's strict contract.
package system_config_checks

import (
	"encoding/json"
	"os"
	"testing"

	presentation "easelect/frontend/shared/front_page_presentation"
)

func TestHomeTextStyleGenericWriteTwinExamples(t *testing.T) {
	raw, err := os.ReadFile("../../../testing/shared_contracts/home_presentation_validation_examples.json")
	if err != nil {
		t.Fatal(err)
	}
	var examples []struct {
		Name     string
		Value    json.RawMessage
		Valid    bool
		Readable bool
	}
	if err := json.Unmarshal(raw, &examples); err != nil {
		t.Fatal(err)
	}
	for _, example := range examples {
		t.Run(example.Name, func(t *testing.T) {
			valid := false
			if example.Readable {
				var value presentation.Value
				if err := json.Unmarshal(example.Value, &value); err != nil {
					t.Fatal(err)
				}
				valid = value.SchemaVersion == 2 ||
					(value.SchemaVersion == 3 && (value.TextStyle.Preset != "default" || value.TextStyle.Reveal.Mode != "none")) ||
					(value.SchemaVersion == 4 && value.PhoneAlignment != "inherit")
			}
			err := ValidateRow("system_config", map[string]interface{}{"key": "front_page_presentation", "value_type": 5, "json_value": example.Value})
			if (err == nil) != valid {
				t.Fatal(err)
			}
		})
	}
}
