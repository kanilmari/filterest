// text_style_validation_test.go
// Runs the browser/server twin examples against strict writes and stored reads.
// Connects nested text-style choices, types, keys and bounds to one fixture.
// Keeps compatibility conversions independent of the original stored bytes.
package front_page_presentation

import (
	"encoding/json"
	"os"
	"testing"
)

func TestHomeTextStyleTwinExamples(t *testing.T) {
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
			if _, err := Parse(example.Value); (err == nil) != example.Valid {
				t.Fatal("write", err)
			}
			got, err := ParseStored(example.Value)
			if (err == nil) != example.Readable {
				t.Fatal("read", err)
			}
			if example.Readable && got.SchemaVersion != 4 {
				t.Fatal(got)
			}
			if example.Readable && got.PhoneAlignment != Rules().Default.PhoneAlignment && !example.Valid {
				t.Fatal(got)
			}
			var stored struct {
				SchemaVersion int `json:"schema_version"`
			}
			json.Unmarshal(example.Value, &stored)
			if example.Readable && stored.SchemaVersion < 3 && got.TextStyle != Rules().Default.TextStyle {
				t.Fatal(got)
			}
		})
	}
}
