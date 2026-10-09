// definition.go
// Defines and validates dataset appearance using the browser's embedded JSON rules.
// Connects version-one compatibility and version-two ownership with one policy.
// Keeps theme independence separate from storage place and UI steps advisory.
package dataset_appearance

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"math"
	"slices"
	"strconv"
	"strings"
)

//go:embed definition.json
var source []byte

// Place is storage ownership, independent of the light/dark/shared theme grouping.
type Place string

const (
	TabOnly     Place = "tab_only"
	SiteOnly    Place = "site_only"
	SiteDefault Place = "site_default"
)

// Field describes one appearance value. Step is a UI hint, never a storage limit.
type Field struct {
	Place             Place    `json:"place"`
	Type              string   `json:"type"`
	Default           any      `json:"default"`
	DarkDefault       any      `json:"dark_default"`
	Min               float64  `json:"min"`
	Max               float64  `json:"max"`
	Step              float64  `json:"step"`
	Values            []string `json:"values"`
	DevelopmentValues []string `json:"development_values"`
	RuleFrom          string   `json:"rule_from"`
	DerivedFrom       string   `json:"derived_from"`
	LegacyReadTargets []string `json:"legacy_read_targets"`
}

// Definition owns the light/dark template, shared leaves and compatibility policy.
type Definition struct {
	ThemeOwners  []string         `json:"theme_owners"`
	ThemeFields  map[string]Field `json:"theme_fields"`
	SharedFields map[string]Field `json:"shared_fields"`
	MaskOrder    [][]string       `json:"mask_order"`
	Aliases      map[string]struct {
		Owners []string `json:"owners"`
		Field  string   `json:"field"`
	} `json:"aliases"`
	Compatibility struct {
		SharedWriteOptional []string `json:"shared_write_optional"`
		BrowserOptional     []string `json:"browser_optional"`
		BrowserUnchecked    []string `json:"browser_unchecked"`
	} `json:"compatibility"`
}

// Rules returns independent values so consumers cannot mutate shared policy.
func Rules() Definition {
	var definition Definition
	if err := json.Unmarshal(source, &definition); err != nil {
		panic(err)
	}
	return definition
}

// Field resolves a stored path, including the compatibility-only shared blur.
func (definition Definition) Field(path string) (Field, bool) {
	owner, key, found := strings.Cut(path, ".")
	if !found {
		return Field{}, false
	}
	var field Field
	var exists bool
	if owner == "shared" {
		field, exists = definition.SharedFields[key]
	} else if slices.Contains(definition.ThemeOwners, owner) {
		field, exists = definition.ThemeFields[key]
		if owner == "dark" && field.DarkDefault != nil {
			field.Default = field.DarkDefault
		}
	}
	if field.RuleFrom != "" {
		resolved, ok := definition.Field(field.RuleFrom)
		resolved.DerivedFrom, resolved.LegacyReadTargets = field.DerivedFrom, field.LegacyReadTargets
		// Borrow validation bounds, not storage ownership, for derived legacy values.
		resolved.Place = field.Place
		return resolved, ok
	}
	return field, exists
}

// Defaults retains the stored light/dark/shared shape, including legacy shared blur.
func (definition Definition) Defaults() map[string]map[string]any {
	defaults := map[string]map[string]any{}
	for _, owner := range append(slices.Clone(definition.ThemeOwners), "shared") {
		fields := definition.ThemeFields
		if owner == "shared" {
			fields = definition.SharedFields
		}
		defaults[owner] = map[string]any{}
		for key := range fields {
			field, _ := definition.Field(owner + "." + key)
			defaults[owner][key] = field.Default
		}
	}
	return defaults
}

// CanonicalPaths inventories independently configurable values with their owners.
func (definition Definition) CanonicalPaths() []string {
	paths := []string{}
	for owner, fields := range definition.Defaults() {
		for key := range fields {
			field, _ := definition.Field(owner + "." + key)
			if field.DerivedFrom == "" {
				paths = append(paths, owner+"."+key)
			}
		}
	}
	slices.Sort(paths)
	return paths
}

// PathsForPlace derives a sorted canonical inventory; aliases and derived blur
// never add stored values. Its browser twin is DATASET_APPEARANCE_PATHS_BY_PLACE.
func (definition Definition) PathsForPlace(place Place) []string {
	paths := []string{}
	for _, path := range definition.CanonicalPaths() {
		field, _ := definition.Field(path)
		if field.Place == place {
			paths = append(paths, path)
		}
	}
	return paths
}

// PlaceForPath exposes canonical ownership, including a UI alias's target.
// Aliases remain invalid stored keys; derived blur has no independent place.
// Its browser twin is validator.js:datasetAppearancePlace.
func (definition Definition) PlaceForPath(path string) (Place, bool) {
	owner, key, _ := strings.Cut(path, ".")
	if alias, ok := definition.Aliases[key]; ok && slices.Contains(alias.Owners, owner) {
		path = owner + "." + alias.Field
	}
	field, ok := definition.Field(path)
	return field.Place, ok && field.DerivedFrom == "" &&
		(field.Place == TabOnly || field.Place == SiteOnly || field.Place == SiteDefault)
}

// DefaultsForPlace returns independent flat canonical-path values for version two.
// Its browser twin is validator.js:datasetAppearanceDefaultsForPlace.
func (definition Definition) DefaultsForPlace(place Place) map[string]any {
	defaults := map[string]any{}
	for _, path := range definition.PathsForPlace(place) {
		field, _ := definition.Field(path)
		defaults[path] = field.Default
	}
	return defaults
}

// ValidateLeaf validates a stored path without enforcing a slider's step.
// Version-two overrides additionally require the SiteDefault inventory.
func (definition Definition) ValidateLeaf(path string, value any, development bool) error {
	field, exists := definition.Field(path)
	if !exists {
		return fmt.Errorf("unknown appearance field %s", path)
	}
	valid := false
	switch field.Type {
	case "boolean":
		_, valid = value.(bool)
	case "number", "integer":
		number, ok := value.(float64)
		valid = ok && !math.IsNaN(number) && !math.IsInf(number, 0) && number >= field.Min && number <= field.Max
		if field.Type == "integer" {
			valid = valid && math.Trunc(number) == number
		}
	case "string":
		text, ok := value.(string)
		valid = ok && (slices.Contains(field.Values, text) || (development && slices.Contains(field.DevelopmentValues, text)))
	case "hex_color":
		text, ok := value.(string)
		if ok && len(text) == 7 && text[0] == '#' {
			_, err := strconv.ParseUint(text[1:], 16, 24)
			valid = err == nil
		}
	}
	if !valid {
		return fmt.Errorf("invalid appearance field %s", path)
	}
	return nil
}

// Validate checks complete values and mask dependencies, mirroring validator.js.
// Legacy request omissions and stored read normalization belong to the caller.
func Validate(raw any, development bool) error {
	data, err := json.Marshal(raw)
	if bytes, ok := raw.(json.RawMessage); ok {
		data, err = bytes, nil
	}
	if err != nil {
		return err
	}
	var config map[string]map[string]any
	if err := json.Unmarshal(data, &config); err != nil {
		return err
	}
	rules := Rules()
	defaults := rules.Defaults()
	if len(config) != len(defaults) {
		return fmt.Errorf("appearance requires light, dark and shared groups")
	}
	for owner, fields := range defaults {
		if len(config[owner]) != len(fields) {
			return fmt.Errorf("invalid appearance keys for %s", owner)
		}
		for key := range fields {
			if err := rules.ValidateLeaf(owner+"."+key, config[owner][key], development); err != nil {
				return err
			}
		}
	}
	for _, owner := range rules.ThemeOwners {
		for _, order := range rules.MaskOrder {
			for index := 1; index < len(order); index++ {
				if config[owner][order[index-1]].(float64) > config[owner][order[index]].(float64) {
					return fmt.Errorf("%s mask values must be ascending: %v", owner, order)
				}
			}
		}
	}
	return nil
}

// ValidateTabValuesV2 requires all 28 tab-owned values and checks both themes'
// masks within this tab alone. Its twin is validator.js:isValidDatasetAppearanceTabValuesV2.
// Existing runtime readers/writers continue to use the version-one Validate.
func ValidateTabValuesV2(raw any, development bool) error {
	values, err := validatePlaceValuesV2(raw, TabOnly, true, development)
	if err != nil {
		return err
	}
	rules := Rules()
	for _, owner := range rules.ThemeOwners {
		for _, order := range rules.MaskOrder {
			for index := 1; index < len(order); index++ {
				if values[owner+"."+order[index-1]].(float64) > values[owner+"."+order[index]].(float64) {
					return fmt.Errorf("%s tab mask values must be ascending: %v", owner, order)
				}
			}
		}
	}
	return nil
}

// ValidateSiteValuesV2 requires exactly the seven site-only canonical paths.
// Its browser twin is validator.js:isValidDatasetAppearanceSiteValuesV2.
func ValidateSiteValuesV2(raw any, development bool) error {
	_, err := validatePlaceValuesV2(raw, SiteOnly, true, development)
	return err
}

// ValidateDefaultsV2 requires all nine defaults that a tab may override.
// Its browser twin is validator.js:isValidDatasetAppearanceDefaultsV2.
func ValidateDefaultsV2(raw any, development bool) error {
	_, err := validatePlaceValuesV2(raw, SiteDefault, true, development)
	return err
}

// ValidateOverridesV2 accepts only sparse default overrides; presence preserves
// zero, false and equality. It never mutates or removes a supplied entry.
// Its browser twin is validator.js:isValidDatasetAppearanceOverridesV2.
func ValidateOverridesV2(raw any, development bool) error {
	_, err := validatePlaceValuesV2(raw, SiteDefault, false, development)
	return err
}

// Flat version-two maps use canonical paths, never nested theme groups, aliases
// or derived values. JSON normalization accepts Go integer inputs like stored JSON.
func validatePlaceValuesV2(raw any, place Place, complete, development bool) (map[string]any, error) {
	data, err := json.Marshal(raw)
	if bytes, ok := raw.(json.RawMessage); ok {
		data, err = bytes, nil
	}
	if err != nil {
		return nil, err
	}
	var values map[string]any
	if err := json.Unmarshal(data, &values); err != nil {
		return nil, err
	}
	if values == nil {
		return nil, fmt.Errorf("appearance %s values require an object", place)
	}
	rules := Rules()
	paths := rules.PathsForPlace(place)
	if complete && len(values) != len(paths) {
		return nil, fmt.Errorf("appearance %s requires %d values", place, len(paths))
	}
	for path, value := range values {
		if !slices.Contains(paths, path) {
			return nil, fmt.Errorf("appearance path %s is forbidden in %s values", path, place)
		}
		if err := rules.ValidateLeaf(path, value, development); err != nil {
			return nil, err
		}
	}
	return values, nil
}
