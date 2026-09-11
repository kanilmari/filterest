// Package card_roles owns the immutable card renderer protocol.
// Both creation validation and frontend authoring read catalog.js; assignments
// remain ordinary column metadata rather than a mutable role-definition table.
package card_roles

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"strings"
)

//go:embed catalog.js
var catalogJSON []byte

type Definition struct {
	ID             string `json:"id"`
	InitialShowKey *bool  `json:"initial_show_key"`
	Numbered       bool   `json:"numbered"`
}
type Catalog struct {
	Roles     []Definition `json:"roles"`
	Modifiers []string     `json:"modifiers"`
}

var definitions = loadCatalog()

func loadCatalog() Catalog {
	result, err := decodeCatalog(catalogJSON)
	if err != nil {
		panic(err)
	}
	return result
}

// Decode the one permitted data-module envelope; never evaluate JavaScript.
func decodeCatalog(source []byte) (Catalog, error) {
	text := strings.TrimSpace(string(source))
	for strings.HasPrefix(text, "//") {
		_, remaining, found := strings.Cut(text, "\n")
		if !found {
			return Catalog{}, fmt.Errorf("catalog export missing")
		}
		text = strings.TrimSpace(remaining)
	}
	const prefix = "export default "
	if !strings.HasPrefix(text, prefix) || !strings.HasSuffix(text, ";") {
		return Catalog{}, fmt.Errorf("catalog must be one default JSON export")
	}
	payload := strings.TrimSpace(strings.TrimSuffix(strings.TrimPrefix(text, prefix), ";"))
	if !strings.HasPrefix(payload, "{") || !strings.HasSuffix(payload, "}") {
		return Catalog{}, fmt.Errorf("catalog must export a JSON object")
	}
	var result Catalog
	if err := json.Unmarshal([]byte(payload), &result); err != nil {
		return Catalog{}, err
	}
	if len(result.Roles) == 0 {
		return Catalog{}, fmt.Errorf("catalog roles missing")
	}
	return result, nil
}

// IsValid accepts existing comma combinations, supported numeric role suffixes,
// and both legacy spellings of the translation-key modifier.
func IsValid(value string) bool {
	if strings.TrimSpace(value) == "" {
		return true
	}
	for _, item := range strings.Split(value, ",") {
		parts := strings.Split(strings.TrimSpace(item), "+")
		if len(parts) > 2 || !validBase(strings.TrimSpace(parts[0])) {
			return false
		}
		if len(parts) == 2 {
			validModifier := false
			for _, modifier := range definitions.Modifiers {
				if strings.TrimSpace(parts[1]) == modifier {
					validModifier = true
				}
			}
			if !validModifier {
				return false
			}
		}
	}
	return true
}
func validBase(value string) bool {
	for _, role := range definitions.Roles {
		if value == role.ID {
			return true
		}
		if !role.Numbered || !strings.HasPrefix(value, role.ID) {
			continue
		}
		suffix := strings.TrimPrefix(value, role.ID)
		if suffix == "" {
			continue
		}
		digits := true
		for _, char := range suffix {
			if char < '0' || char > '9' {
				digits = false
				break
			}
		}
		if digits {
			return true
		}
	}
	return false
}

// InitialShowKey applies only to explicitly authored new columns. A primary
// title/description/keywords role takes priority over an additional-information
// role in combinations, so the same field does not acquire a heading label.
func InitialShowKey(value string) (bool, bool) {
	show := false
	hasDefault := false
	for _, item := range strings.Split(value, ",") {
		base := strings.TrimSpace(strings.SplitN(strings.TrimSpace(item), "+", 2)[0])
		for _, role := range definitions.Roles {
			matches := base == role.ID
			if role.Numbered && strings.HasPrefix(base, role.ID) {
				suffix := strings.TrimPrefix(base, role.ID)
				matches = suffix == "" || strings.Trim(suffix, "0123456789") == ""
			}
			if !matches || role.InitialShowKey == nil {
				continue
			}
			if !*role.InitialShowKey {
				return false, true
			}
			show, hasDefault = true, true
		}
	}
	return show, hasDefault
}
