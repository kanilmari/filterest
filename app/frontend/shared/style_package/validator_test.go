// validator_test.go
// Exercises shared malformed-input examples and every source-defined token bound.
// Connects Go validation to the identical examples read by Vitest.
// Protects the contract and ownership boundary without database or server access.
package style_package

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"
)

const testFont = "00000000-0000-0000-0000-000000000001"

func TestSharedStylePackageExamples(t *testing.T) {
	raw, err := os.ReadFile("../../../testing/shared_contracts/style_package_validation_examples.json")
	if err != nil {
		t.Fatal(err)
	}
	var examples []struct {
		Name       string   `json:"name"`
		Raw        string   `json:"raw"`
		Valid      bool     `json:"valid"`
		KnownFonts []string `json:"known_fonts"`
	}
	if err := json.Unmarshal(raw, &examples); err != nil {
		t.Fatal(err)
	}
	for _, example := range examples {
		t.Run(example.Name, func(t *testing.T) {
			_, err := Parse([]byte(example.Raw), example.KnownFonts)
			if (err == nil) != example.Valid {
				t.Fatalf("valid=%v; error=%v", example.Valid, err)
			}
		})
	}
}

func tokenDocument(scope, key string, value any) []byte {
	raw, _ := json.Marshal(map[string]any{"schema_version": 1, "scopes": map[string]any{
		scope: map[string]any{"light": map[string]any{key: value}, "dark": map[string]any{}},
	}})
	return raw
}

func sampleToken(rule TokenRule, rules Definition) any {
	switch rule.Type {
	case "number", "integer":
		return rule.Min
	case "length":
		for unit, bounds := range rule.Units {
			return map[string]any{"unit": unit, "value": bounds.Min}
		}
	case "color":
		return "#abcdef"
	case "shadow_preset":
		return "soft"
	case "reveal_preset":
		return rules.DefaultReveal
	case "font_binding":
		return map[string]any{"default": testFont, "languages": map[string]any{"fi": testFont}}
	case "responsive_size":
		value := map[string]any{}
		for key, unit := range rule.Fields {
			value[key] = map[string]any{"unit": unit, "value": rule.Units[unit].Min}
		}
		return value
	}
	panic("unsupported test token type")
}

func TestEveryStyleTokenScopeTypeAndBounds(t *testing.T) {
	rules := Rules()
	for key, rule := range rules.Tokens {
		t.Run(key, func(t *testing.T) {
			for scope := range rules.Scopes {
				_, err := Parse(tokenDocument(scope, key, sampleToken(rule, rules)), []string{testFont})
				allowed := false
				for _, permitted := range rule.Scopes {
					allowed = allowed || permitted == scope
				}
				if (err == nil) != allowed {
					t.Fatalf("scope %s; allowed=%v; error=%v", scope, allowed, err)
				}
			}
			for _, bad := range []any{nil, true, []any{}, "url(/font)"} {
				if _, err := Parse(tokenDocument(rule.Scopes[0], key, bad), nil); err == nil {
					t.Fatalf("accepted wrong type: %v", bad)
				}
			}
			if rule.Type == "number" || rule.Type == "integer" {
				for _, value := range []float64{rule.Min, rule.Max, rule.Min - 1, rule.Max + 1} {
					_, err := Parse(tokenDocument(rule.Scopes[0], key, value), nil)
					if (err == nil) != (value >= rule.Min && value <= rule.Max) {
						t.Fatal(value, err)
					}
				}
			}
			if rule.Type == "length" {
				for unit, bounds := range rule.Units {
					for _, value := range []float64{bounds.Min, bounds.Max, bounds.Min - 1, bounds.Max + 1} {
						_, err := Parse(tokenDocument(rule.Scopes[0], key, map[string]any{"unit": unit, "value": value}), nil)
						if (err == nil) != (value >= bounds.Min && value <= bounds.Max) {
							t.Fatal(unit, value, err)
						}
					}
				}
				if _, err := Parse(tokenDocument(rule.Scopes[0], key, map[string]any{"unit": "vh", "value": 1}), nil); err == nil {
					t.Fatal("unsupported unit accepted")
				}
			}
		})
	}
}

func TestStylePackageBudgetsAndIndependentThemes(t *testing.T) {
	rules := Rules()
	raw := []byte(`{"schema_version":1,"scopes":{}}`)
	if _, err := Parse(append(raw, []byte(strings.Repeat(" ", rules.Limits["manifest_bytes"]-len(raw)))...), nil); err != nil {
		t.Fatal(err)
	}
	if _, err := Parse(append(raw, []byte(strings.Repeat(" ", rules.Limits["manifest_bytes"]+1))...), nil); err == nil {
		t.Fatal("oversized manifest accepted")
	}
	if _, err := Parse([]byte(strings.Repeat("[", rules.Limits["json_depth"]+1)+strings.Repeat("]", rules.Limits["json_depth"]+1)), nil); err == nil {
		t.Fatal("deep document accepted")
	}
	if _, err := Parse([]byte{'{', '"', 0xff, '"', ':', '1', '}'}, nil); err == nil {
		t.Fatal("invalid UTF-8 accepted")
	}
	manifest, err := Parse(tokenDocument("home-hero", "heading.color", "#abcdef"), nil)
	if err != nil || len(manifest.Scopes["home-hero"]["dark"]) != 0 {
		t.Fatal("light copied into dark", manifest, err)
	}
	fonts := []string{}
	languages := map[string]any{}
	for i := 0; i <= rules.Limits["font_faces"]; i++ {
		font := fmt.Sprintf("00000000-0000-0000-0000-%012d", i)
		fonts = append(fonts, font)
		languages[fmt.Sprintf("en-x%d", i)] = font
	}
	if _, err := Parse(tokenDocument("site", "font.body", map[string]any{"default": fonts[0], "languages": languages}), fonts); err == nil {
		t.Fatal("font reference budget exceeded")
	}
	languages = map[string]any{}
	for i := 0; i < rules.Limits["assignments"]-1; i++ {
		languages[fmt.Sprintf("en-x%d", i)] = testFont
	}
	if _, err := Parse(tokenDocument("site", "font.body", map[string]any{"default": testFont, "languages": languages}), []string{testFont}); err != nil {
		t.Fatal("assignment boundary refused", err)
	}
	languages["en-extra"] = testFont
	if _, err := Parse(tokenDocument("site", "font.body", map[string]any{"default": testFont, "languages": languages}), []string{testFont}); err == nil {
		t.Fatal("assignment budget exceeded")
	}
}
