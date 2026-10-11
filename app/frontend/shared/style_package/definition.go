// definition.go
// Loads the source-owned style-package vocabulary and ownership boundary.
// Connects Go validation with the browser's identical JSON definition.
// Keeps immutable presentation policy separate from later storage and activation.
package style_package

import (
	_ "embed"
	"encoding/json"
)

//go:embed definition.json
var source []byte

type Bounds struct {
	Min float64 `json:"min"`
	Max float64 `json:"max"`
}

type TokenRule struct {
	Type   string            `json:"type"`
	CSS    string            `json:"css"`
	Scopes []string          `json:"scopes"`
	Owner  string            `json:"owner"`
	Role   string            `json:"role"`
	Min    float64           `json:"min"`
	Max    float64           `json:"max"`
	Units  map[string]Bounds `json:"units"`
	Fields map[string]string `json:"fields"`
}

type Scope struct {
	Selector string  `json:"selector"`
	Parent   *string `json:"parent"`
}

type Owner struct {
	Definition string   `json:"definition"`
	Fields     []string `json:"fields"`
	CSS        []string `json:"css"`
}

// Definition is the shared, versioned vocabulary; its selectors are trusted source.
type Definition struct {
	SchemaVersion        int                  `json:"schema_version"`
	ManifestFields       []string             `json:"manifest_fields"`
	Themes               []string             `json:"themes"`
	ThemeRule            string               `json:"theme_rule"`
	AssignmentCosts      map[string]int       `json:"assignment_costs"`
	Limits               map[string]int       `json:"limits"`
	FontRoles            []string             `json:"font_roles"`
	FontBindingFields    []string             `json:"font_binding_fields"`
	FontReferencePattern string               `json:"font_reference_pattern"`
	LanguagePattern      string               `json:"language_pattern"`
	ColorPattern         string               `json:"color_pattern"`
	Scopes               map[string]Scope     `json:"scopes"`
	RevealPresets        map[string]any       `json:"reveal_presets"`
	DefaultReveal        string               `json:"default_reveal"`
	ShadowPresets        map[string]string    `json:"shadow_presets"`
	Reserved             map[string]Owner     `json:"reserved"`
	Tokens               map[string]TokenRule `json:"tokens"`
}

// Rules returns a fresh copy so a caller cannot mutate the shared contract.
func Rules() Definition {
	var rules Definition
	if err := json.Unmarshal(source, &rules); err != nil {
		panic(err)
	}
	return rules
}
