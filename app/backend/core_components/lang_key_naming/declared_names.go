// declared_names.go
// Defines finite, file-owned catalogues for names assembled outside literal calls.
// Connects producer comments to the code scan without adding runtime translations.
// Every declaration names its builder; removing that builder removes its evidence.
package lang_key_naming

import (
	"encoding/json"
	"fmt"
	"io"
	"strings"
)

const DeclarationMarker = "// lang-key-declaration: "

// Declaration belongs to the scanned file, including in additional source roots.
// Keys is a full-name catalogue; Prefix/Values/Suffix is a finite naming family.
// Build is a source expression checked against live code, never against comments.
type Declaration struct {
	Schema string   `json:"schema,omitempty"`
	Owner  string   `json:"-"`
	Build  string   `json:"build"`
	Keys   []string `json:"keys,omitempty"`
	Prefix string   `json:"prefix,omitempty"`
	Values []string `json:"values,omitempty"`
	Suffix string   `json:"suffix,omitempty"`
}

// ParseDeclaration reads one explicit comment. Invalid declarations fail the scan
// instead of silently reducing evidence and allowing a partial scan to look fresh.
func ParseDeclaration(owner, comment string) (Declaration, error) {
	var d Declaration
	decoder := json.NewDecoder(strings.NewReader(strings.TrimPrefix(comment, DeclarationMarker)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&d); err != nil {
		return d, fmt.Errorf("%s: language-key declaration: %w", owner, err)
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		return d, fmt.Errorf("%s: trailing language-key declaration data", owner)
	}
	d.Owner = owner
	if d.Schema != "" && d.Schema != "linked_name" {
		return d, fmt.Errorf("%s: unknown schema naming declaration", owner)
	}
	full := len(d.Keys) > 0 && d.Prefix == "" && len(d.Values) == 0 && d.Suffix == "" && d.Schema == ""
	finite := len(d.Keys) == 0 && d.Prefix != "" && len(d.Values) > 0 && d.Schema == ""
	schema := d.Schema == "linked_name" && len(d.Keys) == 0 && d.Prefix == "" && len(d.Values) == 0 && d.Suffix == ""
	if strings.TrimSpace(d.Build) == "" || !(full || finite || schema) {
		return d, fmt.Errorf("%s: declaration requires a builder and exactly one full catalogue, finite family or schema rule", owner)
	}
	for _, value := range d.Values {
		if strings.TrimSpace(value) == "" {
			return d, fmt.Errorf("%s: empty declared value", owner)
		}
	}
	for _, key := range d.Names() {
		if strings.TrimSpace(key) == "" || strings.ContainsAny(key, "*\n\r") {
			return d, fmt.Errorf("%s: invalid declared key %q", owner, key)
		}
	}
	return d, nil
}

// Names never expands against arbitrary registry prefixes.
func (d Declaration) Names() []string {
	if len(d.Keys) != 0 {
		return append([]string(nil), d.Keys...)
	}
	names := make([]string, 0, len(d.Values))
	for _, value := range d.Values {
		names = append(names, d.Prefix+value+d.Suffix)
	}
	return names
}
