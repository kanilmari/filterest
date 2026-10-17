// lang_key_declared_evidence.go
// Reads finite producer-owned declarations into B3's existing code evidence path.
// Bridges lang_key_naming and each configured source root, including compositions.
// Uses lexical builder matches so comments and declaration text cannot self-protect.
package system_table_tools

import (
	"path/filepath"
	"strings"

	"easelect/backend/core_components/lang_key_naming"
)

func declaredLangKeyCandidates(path, raw string, tokens []langKeyCodeLexeme) ([]sourceEntry, error) {
	if !strings.Contains(raw, lang_key_naming.DeclarationMarker) {
		return nil, nil
	}
	var results []sourceEntry
	var comments []string
	lexLangKeyCode(raw, filepath.Ext(path), func(comment string) {
		if strings.HasPrefix(comment, lang_key_naming.DeclarationMarker) {
			comments = append(comments, comment)
		}
	})
	for _, comment := range comments {
		d, err := lang_key_naming.ParseDeclaration(path, comment)
		if err != nil {
			return nil, err
		}
		_, builder := lexLangKeyCode(d.Build, filepath.Ext(path))
		if !containsLangKeyTokens(tokens, builder) {
			continue
		}
		// Prefix variables (account mail) also require their assignment to survive.
		// Direct concatenations and templates carry their prefix in the builder.
		if d.Prefix != "" && !strings.Contains(d.Build, d.Prefix) && !assignedLangKeyPrefix(path, raw, builder, d.Prefix) {
			continue
		}
		if d.Schema == "linked_name" {
			results = append(results, sourceEntry{filePath: d.Owner, schemaAlias: true, schemaBuilder: d.Build})
			continue
		}
		for _, key := range d.Names() {
			results = append(results, sourceEntry{langKey: key, filePath: d.Owner, literalUI: reviewedUILiteralCatalogue(d)})
		}
	}
	return results, nil
}

func containsLangKeyTokens(tokens, needle []langKeyCodeLexeme) bool {
	if len(needle) == 0 {
		return false
	}
	for start := 0; start+len(needle) <= len(tokens); start++ {
		match := true
		for i := range needle {
			if tokens[start+i] != needle[i] {
				match = false
				break
			}
		}
		if match {
			return true
		}
	}
	return false
}
