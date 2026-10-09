// definition.go
// Defines and validates dataset appearance using the browser's embedded JSON rules.
// Connects site-wide values and future per-dataset leaves with one policy.
// Keeps UI steps advisory and the legacy shared blur outside the canonical inventory.
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

// Field describes one appearance value. Step is a UI hint, never a storage limit.
type Field struct {
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

// ValidateLeaf validates a stored path without enforcing a slider's step.
// Future overrides must use CanonicalPaths to exclude derived compatibility leaves.
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
