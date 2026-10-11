// validator.go
// Validates typed style-package manifests against the embedded source definition.
// Connects future Go callers with the same rules used by validator.js.
// Refuses CSS text, reserved ownership and unregistered font references without I/O.
package style_package

import (
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"slices"
)

// Manifest contains only validated, sparse assignments; themes never copy each other.
type Manifest struct {
	SchemaVersion int                                  `json:"schema_version"`
	Scopes        map[string]map[string]map[string]any `json:"scopes"`
}

// Parse checks raw JSON, including duplicates and budgets. knownFonts comes from a
// trusted registry caller; nil permits no font assignments. No registry is added here.
// Its browser twin is validator.js:parseStylePackageJSON.
func Parse(raw []byte, knownFonts []string) (Manifest, error) {
	rules := Rules()
	var manifest Manifest
	if len(raw) > rules.Limits["manifest_bytes"] {
		return manifest, fmt.Errorf("style manifest byte limit exceeded")
	}
	value, err := readJSON(raw, rules.Limits["json_depth"])
	if err != nil {
		return manifest, err
	}
	fields, ok := objectFields(value, rules.ManifestFields)
	if !ok || !numberIn(fields["schema_version"], float64(rules.SchemaVersion), float64(rules.SchemaVersion), true) {
		return manifest, fmt.Errorf("invalid style manifest fields or version")
	}
	scopes, ok := fields["scopes"].(map[string]any)
	if !ok {
		return manifest, fmt.Errorf("scopes must be an object")
	}
	manifest.SchemaVersion = rules.SchemaVersion
	manifest.Scopes = map[string]map[string]map[string]any{}
	assignments := 0
	fontReferences := map[string]bool{}
	for scope, value := range scopes {
		if _, valid := rules.Scopes[scope]; !valid {
			return Manifest{}, fmt.Errorf("unknown style scope %q", scope)
		}
		themes, valid := objectFields(value, rules.Themes)
		if !valid {
			return Manifest{}, fmt.Errorf("scope %q requires explicit light and dark objects", scope)
		}
		manifest.Scopes[scope] = map[string]map[string]any{}
		for _, theme := range rules.Themes {
			tokens, valid := themes[theme].(map[string]any)
			if !valid {
				return Manifest{}, fmt.Errorf("theme %q must be an object", theme)
			}
			for key, value := range tokens {
				if owner := reservedOwner(key, rules); owner != "" {
					return Manifest{}, fmt.Errorf("token %q is reserved to %s", key, owner)
				}
				rule, exists := rules.Tokens[key]
				if !exists || rule.Owner != "package" || !slices.Contains(rule.Scopes, scope) {
					return Manifest{}, fmt.Errorf("unknown or disallowed token %q in %q", key, scope)
				}
				if !validToken(value, rule, rules, knownFonts, fontReferences) {
					return Manifest{}, fmt.Errorf("invalid value for token %q", key)
				}
				assignments += rules.AssignmentCosts["token"]
				if rule.Type == "font_binding" {
					languages := value.(map[string]any)["languages"].(map[string]any)
					assignments += len(languages) * rules.AssignmentCosts["language_font_slot"]
				}
			}
			manifest.Scopes[scope][theme] = tokens
		}
	}
	if assignments > rules.Limits["assignments"] || len(fontReferences) > rules.Limits["font_faces"] {
		return Manifest{}, fmt.Errorf("style assignment or font reference limit exceeded")
	}
	return manifest, nil
}

func objectFields(value any, keys []string) (map[string]any, bool) {
	object, ok := value.(map[string]any)
	if !ok || len(object) != len(keys) {
		return nil, false
	}
	for _, key := range keys {
		if _, exists := object[key]; !exists {
			return nil, false
		}
	}
	return object, true
}

func numeric(value any) (float64, bool) {
	number, ok := value.(json.Number)
	if !ok {
		return 0, false
	}
	n, err := number.Float64()
	return n, err == nil && !math.IsNaN(n) && !math.IsInf(n, 0)
}

func numberIn(value any, min, max float64, integer bool) bool {
	n, ok := numeric(value)
	return ok && n >= min && n <= max && (!integer || math.Trunc(n) == n)
}

func validLength(value any, units map[string]Bounds) bool {
	object, ok := objectFields(value, []string{"value", "unit"})
	if !ok {
		return false
	}
	unit, ok := object["unit"].(string)
	bounds, known := units[unit]
	return ok && known && numberIn(object["value"], bounds.Min, bounds.Max, false)
}

func reservedOwner(key string, rules Definition) string {
	for owner, fields := range rules.Reserved {
		if slices.Contains(fields.Fields, key) || slices.Contains(fields.CSS, key) {
			return owner
		}
	}
	return ""
}

func validToken(value any, rule TokenRule, rules Definition, knownFonts []string, references map[string]bool) bool {
	switch rule.Type {
	case "number", "integer":
		return numberIn(value, rule.Min, rule.Max, rule.Type == "integer")
	case "length":
		return validLength(value, rule.Units)
	case "color":
		text, ok := value.(string)
		return ok && regexp.MustCompile(rules.ColorPattern).MatchString(text)
	case "shadow_preset", "reveal_preset":
		text, ok := value.(string)
		if !ok {
			return false
		}
		if rule.Type == "shadow_preset" {
			_, ok = rules.ShadowPresets[text]
		} else {
			_, ok = rules.RevealPresets[text]
		}
		return ok
	case "responsive_size":
		keys := make([]string, 0, len(rule.Fields))
		for key := range rule.Fields {
			keys = append(keys, key)
		}
		fields, ok := objectFields(value, keys)
		if !ok {
			return false
		}
		for key, unit := range rule.Fields {
			if !validLength(fields[key], map[string]Bounds{unit: rule.Units[unit]}) {
				return false
			}
		}
		minimum, _ := numeric(fields["min"].(map[string]any)["value"])
		maximum, _ := numeric(fields["max"].(map[string]any)["value"])
		return minimum <= maximum
	case "font_binding":
		fields, ok := objectFields(value, rules.FontBindingFields)
		if !ok || !slices.Contains(rules.FontRoles, rule.Role) {
			return false
		}
		languages, ok := fields["languages"].(map[string]any)
		if !ok || !validFont(fields["default"], rules, knownFonts, references) {
			return false
		}
		for language, font := range languages {
			if !regexp.MustCompile(rules.LanguagePattern).MatchString(language) || !validFont(font, rules, knownFonts, references) {
				return false
			}
		}
		return true
	default:
		return false
	}
}

func validFont(value any, rules Definition, knownFonts []string, references map[string]bool) bool {
	font, ok := value.(string)
	if !ok || !regexp.MustCompile(rules.FontReferencePattern).MatchString(font) || !slices.Contains(knownFonts, font) {
		return false
	}
	references[font] = true
	return true
}
