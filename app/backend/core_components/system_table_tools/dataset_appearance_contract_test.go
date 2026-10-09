// dataset_appearance_contract_test.go
// Exercises the split site validator against the shared appearance examples.
// Connects existing request compatibility and stored blur inheritance with browser fixtures.
// Pins serialized defaults and accepted storage values without a database.
package system_table_tools

import (
	"bytes"
	"encoding/json"
	"os"
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
	defaults, err := json.Marshal(defaultSitePresentationSettings().DatasetCoverTheme)
	if err != nil || string(defaults) != contract.BaselineGoJSON {
		t.Fatal("default serialized appearance changed", err)
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
			body, err := json.Marshal(map[string]any{
				"version": "none", "dataset_cover_theme": config, "row_article_timestamp_display_mode": "date_time",
			})
			if err != nil {
				t.Fatal(err)
			}
			wantWrite := example.Valid
			if example.WriteValid != nil {
				wantWrite = *example.WriteValid
			}
			decoded, err := decodeSitePresentationSettings(bytes.NewReader(body))
			if (err == nil) != wantWrite {
				t.Fatalf("write valid=%v, error=%v", wantWrite, err)
			}
			if err == nil && example.Valid {
				encoded, _ := json.Marshal(decoded.DatasetCoverTheme)
				var persisted map[string]map[string]any
				if err := json.Unmarshal(encoded, &persisted); err != nil {
					t.Fatal(err)
				}
				for owner, fields := range config {
					for key, value := range fields {
						actual, _ := json.Marshal(persisted[owner][key])
						want, _ := json.Marshal(value)
						if !bytes.Equal(actual, want) {
							t.Fatalf("changed %s.%s", owner, key)
						}
					}
				}
			}
			if example.LegacyBlur != nil {
				stored := defaultSitePresentationSettings().DatasetCoverTheme
				raw, _ := json.Marshal(config)
				if err := json.Unmarshal(raw, &stored); err != nil {
					t.Fatal(err)
				}
				inheritLegacyImageBlur(string(raw), &stored)
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
