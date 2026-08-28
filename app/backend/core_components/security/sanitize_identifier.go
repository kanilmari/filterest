// sanitize_identifier.go
// Provides SQL identifier sanitization to prevent injection attacks. Validates and escapes
// table names, column names, and other database identifiers before use in dynamic queries.
// Exists to protect schema-building code that must compose SQL identifiers dynamically.
package security

import (
	"fmt"
	"regexp"
)

// Pre-compiled regexps — compiled once at init, not on every call
var (
	reNordicChars     = regexp.MustCompile(`[åäöÅÄÖ]`)
	reValidIdentifier = regexp.MustCompile(`^[a-zA-Z_][a-zA-Z0-9_]*$`)
)

func SanitizeIdentifier(identifier string) (string, error) {
	// Nordic characters are not allowed in table or column names
	if reNordicChars.FindStringIndex(identifier) != nil {
		return "", fmt.Errorf("nordic characters not allowed in identifier: %s", identifier)
	}

	if reValidIdentifier.MatchString(identifier) {
		return identifier, nil
	}
	return "", fmt.Errorf("invalid identifier: %s", identifier)
}
