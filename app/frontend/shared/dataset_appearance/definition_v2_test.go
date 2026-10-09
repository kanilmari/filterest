// definition_v2_test.go
// Proves the three appearance places and the additive version-two validators.
// Connects Go and browser validation through identical ownership and value examples.
// Protects complete tab-local masks and explicit overrides without runtime cutover.
package dataset_appearance

import (
	"bytes"
	"encoding/json"
	"maps"
	"math"
	"os"
	"reflect"
	"slices"
	"testing"
)

type appearanceV2Contract struct {
	Places  map[Place][]string
	Aliases map[string]struct {
		Canonical string
		Place     Place
	}
	Derived []string
	Cases   []struct {
		Name        string
		Target      string
		Valid       bool
		Development bool
		Set         map[string]any
		Unset       []string
		Raw         json.RawMessage
	}
	TabPairs []struct {
		Name       string
		LeftSet    map[string]any `json:"left_set"`
		RightSet   map[string]any `json:"right_set"`
		LeftValid  bool           `json:"left_valid"`
		RightValid bool           `json:"right_valid"`
	} `json:"tab_pairs"`
}

func readAppearanceV2Contract(t *testing.T) appearanceV2Contract {
	t.Helper()
	data, err := os.ReadFile("../../../testing/shared_contracts/dataset_appearance_v2_examples.json")
	if err != nil {
		t.Fatal(err)
	}
	var contract appearanceV2Contract
	if err := json.Unmarshal(data, &contract); err != nil {
		t.Fatal(err)
	}
	return contract
}

func TestDatasetAppearanceThreePlaces(t *testing.T) {
	rules := Rules()
	contract := readAppearanceV2Contract(t)
	seen := map[string]bool{}
	for place, count := range map[Place]int{TabOnly: 28, SiteOnly: 7, SiteDefault: 9} {
		paths := rules.PathsForPlace(place)
		if len(paths) != count || !slices.Equal(paths, contract.Places[place]) {
			t.Fatalf("unexpected %s inventory: %v", place, paths)
		}
		defaults := rules.DefaultsForPlace(place)
		if len(defaults) != count {
			t.Fatal("incomplete place defaults", place)
		}
		for _, path := range paths {
			field, ok := rules.Field(path)
			actualPlace, owned := rules.PlaceForPath(path)
			if seen[path] || !ok || !owned || actualPlace != place || field.Place != place || field.DerivedFrom != "" {
				t.Fatal("ambiguous or missing canonical ownership", path)
			}
			if value, present := defaults[path]; !present || !reflect.DeepEqual(value, field.Default) {
				t.Fatal("wrong place default", path)
			}
			seen[path] = true
		}
		defaults[paths[0]] = nil
		paths[0] = "changed"
		if rules.DefaultsForPlace(place)[rules.PathsForPlace(place)[0]] == nil {
			t.Fatal("caller mutated place defaults")
		}
	}
	if len(seen) != len(rules.CanonicalPaths()) {
		t.Fatal("unowned canonical field")
	}
	for _, path := range rules.CanonicalPaths() {
		if !seen[path] {
			t.Fatal("canonical field missing from all places", path)
		}
	}
	for path, alias := range contract.Aliases {
		place, ok := rules.PlaceForPath(path)
		canonicalPlace, _ := rules.PlaceForPath(alias.Canonical)
		if !ok || place != alias.Place || place != canonicalPlace || seen[path] {
			t.Fatal("alias does not inherit only its canonical ownership", path)
		}
		if rules.ValidateLeaf(path, false, false) == nil {
			t.Fatal("alias became a stored leaf", path)
		}
	}
	for _, path := range contract.Derived {
		field, ok := rules.Field(path)
		if !ok || field.Place != "" || field.DerivedFrom == "" || seen[path] {
			t.Fatal("derived blur became independently owned", path)
		}
		if _, ok := rules.PlaceForPath(path); ok || rules.ValidateLeaf(path, float64(0), false) != nil {
			t.Fatal("derived blur lost compatibility validation or acquired ownership")
		}
	}
	for _, path := range []string{"unknown.image_blur", "shared.toString", "light.show_cover_photo.extra", "shared.show_cover_photo"} {
		if _, ok := rules.PlaceForPath(path); ok {
			t.Fatal("unknown ownership accepted", path)
		}
	}
}

func TestDatasetAppearanceV2SharedContract(t *testing.T) {
	validators := map[string]func(any, bool) error{
		"tab_values": ValidateTabValuesV2, "site_values": ValidateSiteValuesV2,
		"defaults": ValidateDefaultsV2, "overrides": ValidateOverridesV2,
	}
	places := map[string]Place{"tab_values": TabOnly, "site_values": SiteOnly, "defaults": SiteDefault}
	for _, example := range readAppearanceV2Contract(t).Cases {
		t.Run(example.Target+"/"+example.Name, func(t *testing.T) {
			values := Rules().DefaultsForPlace(places[example.Target])
			maps.Copy(values, example.Set)
			for _, path := range example.Unset {
				delete(values, path)
			}
			var raw any = values
			if example.Raw != nil {
				raw = example.Raw
			}
			before, _ := json.Marshal(raw)
			if err := validators[example.Target](raw, example.Development); (err == nil) != example.Valid {
				t.Fatalf("valid=%v, error=%v", example.Valid, err)
			}
			after, _ := json.Marshal(raw)
			if !bytes.Equal(before, after) {
				t.Fatal("validation changed supplied values or presence")
			}
		})
	}
}

func TestDatasetAppearanceV2CompleteAndForbiddenPaths(t *testing.T) {
	rules := Rules()
	validators := map[Place]func(any, bool) error{
		TabOnly: ValidateTabValuesV2, SiteOnly: ValidateSiteValuesV2, SiteDefault: ValidateDefaultsV2,
	}
	for place, validate := range validators {
		for _, path := range rules.PathsForPlace(place) {
			values := rules.DefaultsForPlace(place)
			delete(values, path)
			if validate(values, false) == nil {
				t.Fatal("missing complete value accepted", path)
			}
		}
		for _, path := range rules.CanonicalPaths() {
			field, _ := rules.Field(path)
			if field.Place == place {
				continue
			}
			values := rules.DefaultsForPlace(place)
			delete(values, rules.PathsForPlace(place)[0])
			values[path] = field.Default
			if validate(values, false) == nil {
				t.Fatal("same-sized foreign place accepted", place, path)
			}
		}
	}
	for _, path := range rules.CanonicalPaths() {
		field, _ := rules.Field(path)
		err := ValidateOverridesV2(map[string]any{path: field.Default}, false)
		if (err == nil) != (field.Place == SiteDefault) {
			t.Fatal("override ownership mismatch", path, err)
		}
	}
}

func TestDatasetAppearanceV2TabLocalMasks(t *testing.T) {
	for _, pair := range readAppearanceV2Contract(t).TabPairs {
		t.Run(pair.Name, func(t *testing.T) {
			left, right := Rules().DefaultsForPlace(TabOnly), Rules().DefaultsForPlace(TabOnly)
			maps.Copy(left, pair.LeftSet)
			maps.Copy(right, pair.RightSet)
			if (ValidateTabValuesV2(left, false) == nil) != pair.LeftValid ||
				(ValidateTabValuesV2(right, false) == nil) != pair.RightValid {
				t.Fatal("one tab's mask influenced the other's validation")
			}
		})
	}
}

func TestDatasetAppearanceV2NumericInputs(t *testing.T) {
	for _, example := range []struct {
		validate func(any, bool) error
		place    Place
		path     string
	}{
		{ValidateTabValuesV2, TabOnly, "light.oval_width"},
		{ValidateSiteValuesV2, SiteOnly, "shared.active_tab_glow_width"},
		{ValidateDefaultsV2, SiteDefault, "shared.card_image_width"},
		{ValidateOverridesV2, "", "shared.card_image_width"},
	} {
		for _, number := range []float64{math.NaN(), math.Inf(1), math.Inf(-1)} {
			values := Rules().DefaultsForPlace(example.place)
			values[example.path] = number
			if example.validate(values, false) == nil {
				t.Fatal("non-finite number accepted", example.path)
			}
		}
		values := Rules().DefaultsForPlace(example.place)
		values[example.path] = int(rulesDefaultNumber(example.path))
		if err := example.validate(values, false); err != nil {
			t.Fatal("Go integer input rejected", example.path, err)
		}
	}
}

func rulesDefaultNumber(path string) float64 {
	field, _ := Rules().Field(path)
	return field.Default.(float64)
}
