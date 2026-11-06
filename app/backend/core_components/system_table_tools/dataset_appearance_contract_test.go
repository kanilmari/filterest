// dataset_appearance_contract_test.go
// Exercises the split site validator against the shared appearance examples.
// Connects existing request compatibility and stored blur inheritance with browser fixtures.
// Pins serialized defaults and accepted storage values without a database.
package system_table_tools

import (
	"encoding/json"
	"os"
	"reflect"
	"strings"
	"testing"

	appearance "easelect/frontend/shared/dataset_appearance"
)

func TestSiteDatasetAppearanceSharedContract(t *testing.T) {
	data, err := os.ReadFile("../../../testing/shared_contracts/dataset_appearance_examples.json")
	if err != nil {
		t.Fatal(err)
	}
	var contract struct {
		BaselineGoJSON string `json:"baseline_go_json"`
		Cases          []struct {
			Name        string
			Set         map[string]any
			Unset       []string
			Valid       bool
			WriteValid  *bool `json:"write_valid"`
			Development bool
			LegacyBlur  map[string]any `json:"legacy_blur"`
		}
	}
	if err := json.Unmarshal(data, &contract); err != nil {
		t.Fatal(err)
	}
	defaults, err := json.Marshal(appearance.DefaultConfig())
	if err != nil {
		t.Fatal(err)
	}
	var current, legacy map[string]map[string]any
	if err := json.Unmarshal(defaults, &current); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal([]byte(contract.BaselineGoJSON), &legacy); err != nil {
		t.Fatal(err)
	}
	// Keep the version-one fixture intact as the migration oracle. The only
	// new serialized leaves are the fifteen closed disclosure defaults.
	additional := 0
	for key, value := range current["shared"] {
		if _, existed := legacy["shared"][key]; existed {
			continue
		}
		if !strings.HasSuffix(key, "_initial_open") || value != false {
			t.Fatalf("unexpected new default %s=%v", key, value)
		}
		additional++
		delete(current["shared"], key)
	}
	if additional != 15 || !reflect.DeepEqual(current, legacy) {
		t.Fatalf("legacy defaults changed or disclosure defaults missing: added=%d current=%v", additional, current)
	}
	for _, example := range contract.Cases {
		t.Run(example.Name, func(t *testing.T) {
			environment := "prod"
			if example.Development {
				environment = "dev"
			}
			t.Setenv("ENVIRONMENT_TYPE", environment)
			config := appearance.Rules().Defaults()
			for path, value := range example.Set {
				owner, key, _ := strings.Cut(path, ".")
				if config[owner] == nil {
					config[owner] = map[string]any{}
				}
				config[owner][key] = value
			}
			for _, path := range example.Unset {
				owner, key, _ := strings.Cut(path, ".")
				delete(config[owner], key)
			}
			// Version-one write contracts are now refused. Their raw values
			// remain the normalization oracle for the migration, not a live writer.
			body, _ := json.Marshal(config)
			var configValue any
			_ = json.Unmarshal(body, &configValue)
			if (appearance.Validate(configValue, example.Development) == nil) != example.Valid {
				t.Fatal("legacy normalization rule changed")
			}
			if example.LegacyBlur != nil {
				stored := appearance.DefaultConfig()
				raw, _ := json.Marshal(config)
				if err := json.Unmarshal(raw, &stored); err != nil {
					t.Fatal(err)
				}
				appearance.InheritLegacyImageBlur(string(raw), &stored)
				for owner, value := range example.LegacyBlur {
					// encoding/json retains the prefilled default for an explicit null.
					if value == nil {
						continue
					}
					actual := stored.Light.ImageBlur
					if owner == "dark" {
						actual = stored.Dark.ImageBlur
					}
					if actual != value.(float64) {
						t.Fatalf("legacy %s blur=%v, want %v", owner, actual, value)
					}
				}
			}
		})
	}
}
