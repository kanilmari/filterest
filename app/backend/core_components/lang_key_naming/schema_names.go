// schema_names.go
// Recognizes linked display labels wrapped by reviewed search and sort naming.
// Connects declarations to aliases enumerated by the actual row projections.
// Never infers a relation from a column's spelling.
package lang_key_naming

import "strings"

// LinkedSchemaAlias strips only reviewed wrappers, preserving the exact alias
// for comparison with projection output. No reverse column-name guessing.
func LinkedSchemaAlias(key string) string {
	name := key
	for {
		if base, ok := TrimDynamicPrefix(name); ok {
			name = base
			continue
		}
		if base, ok := TrimDynamicSuffix(name); ok {
			name = base
			continue
		}
		break
	}
	if !strings.HasSuffix(name, " (ln)") || name == " (ln)" {
		return ""
	}
	return name
}
