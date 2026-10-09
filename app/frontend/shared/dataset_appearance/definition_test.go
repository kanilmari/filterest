// definition_test.go
// Proves the canonical appearance inventory and cross-language validation contract.
// Connects the embedded definition with the browser's shared example fixtures.
// Protects inclusive bounds, types, mask order and valid off-step storage values.
package dataset_appearance

import (
	"encoding/json"
	"math"
	"os"
	"slices"
	"strings"
	"testing"
)

func TestDatasetAppearanceContract(t *testing.T) {
	data, err := os.ReadFile("../../../testing/shared_contracts/dataset_appearance_examples.json")
	if err != nil {
		t.Fatal(err)
	}
	var contract struct {
		Cases []struct {
			Name        string
			Set         map[string]any
			Unset       []string
			Valid       bool
			Development bool
		}
	}
	if err := json.Unmarshal(data, &contract); err != nil {
		t.Fatal(err)
	}
	for _, example := range contract.Cases {
		t.Run(example.Name, func(t *testing.T) {
			config := Rules().Defaults()
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
			if err := Validate(config, example.Development); (err == nil) != example.Valid {
				t.Fatalf("valid=%v, error=%v", example.Valid, err)
			}
		})
	}
}

func TestDatasetAppearanceInventoryAndIndependentRules(t *testing.T) {
	rules := Rules()
	paths := rules.CanonicalPaths()
	if len(paths) != 44 || len(rules.ThemeFields) != 13 || len(rules.SharedFields) != 19 ||
		slices.Contains(paths, "shared.image_blur") || slices.Contains(paths, "light.show_cover_photo") {
		t.Fatalf("unexpected canonical inventory: %v", paths)
	}
	if rules.Aliases["show_cover_photo"].Field != "image_opacity" {
		t.Fatal("cover visibility lost its alias")
	}
	legacy, ok := rules.Field("shared.image_blur")
	if !ok || legacy.DerivedFrom != "light.image_blur" || legacy.Default != rules.ThemeFields["image_blur"].Default {
		t.Fatal("legacy blur is not derived from the light theme rule")
	}
	rules.ThemeFields["oval_width"] = Field{}
	if Rules().ThemeFields["oval_width"].Type != "number" {
		t.Fatal("caller mutated shared rules")
	}
	for _, path := range []string{"light.unknown", "unknown.image_blur", "shared.image_blur.extra", "oval_width"} {
		if _, ok := Rules().Field(path); ok {
			t.Fatal("unknown path accepted", path)
		}
	}
}

func TestDatasetAppearanceEveryLeafBoundsTypesAndChoices(t *testing.T) {
	rules := Rules()
	for owner, fields := range rules.Defaults() {
		for key, value := range fields {
			path := owner + "." + key
			field, _ := rules.Field(path)
			if err := rules.ValidateLeaf(path, value, false); err != nil {
				t.Fatal("invalid default", path, err)
			}
			for _, invalid := range []any{nil, []any{}, map[string]any{}} {
				if rules.ValidateLeaf(path, invalid, false) == nil {
					t.Fatal("invalid leaf accepted", path, invalid)
				}
			}
			if field.Type == "number" || field.Type == "integer" {
				for _, valid := range []float64{field.Min, field.Max} {
					if err := rules.ValidateLeaf(path, valid, false); err != nil {
						t.Fatal("inclusive bound rejected", path, valid, err)
					}
				}
				for _, invalid := range []any{field.Min - 1, field.Max + 1, "1", true, math.NaN(), math.Inf(1)} {
					if rules.ValidateLeaf(path, invalid, false) == nil {
						t.Fatal("numeric leaf accepted", path, invalid)
					}
				}
				if field.Type == "integer" && rules.ValidateLeaf(path, field.Min+0.5, false) == nil {
					t.Fatal("fractional integer accepted", path)
				}
			} else if field.Type == "string" {
				for _, choice := range field.Values {
					if err := rules.ValidateLeaf(path, choice, false); err != nil {
						t.Fatal("choice rejected", path, choice, err)
					}
				}
			}
		}
	}
	for _, invalid := range []json.RawMessage{[]byte("null"), []byte("[]"), []byte("false"), []byte("{}")} {
		if Validate(invalid, false) == nil {
			t.Fatal("invalid shape accepted", string(invalid))
		}
	}
}
