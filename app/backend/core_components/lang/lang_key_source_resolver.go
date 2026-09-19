// lang_key_source_resolver.go
// Resolves schema-backed lang-key ownership for exact and dynamic table/column keys.
// Bridges AI-generated missing-key saves and the schema-driven source model in system_lang_key_sources.
// Exists so dynamic dataset keys like add_row_<dataset> inherit the same ownership rules as startup scans.
package lang

import (
	"strings"

	"easelect/backend/core_components/lang_key_naming"
)

type langKeySourceRef struct {
	sourceType string
	sourceHigh string
	sourceLow  string
}

func resolveSchemaSourceRefsForLangKey(
	key string,
	columnToTables map[string][]string,
	tableNames map[string]bool,
) []langKeySourceRef {
	if strings.TrimSpace(key) == "" {
		return nil
	}

	seen := make(map[string]struct{})
	sources := make([]langKeySourceRef, 0)

	appendColumnSources := func(columnName string) {
		tables, ok := columnToTables[columnName]
		if !ok {
			return
		}
		for _, tableName := range tables {
			signature := "column|" + tableName + "|" + columnName
			if _, exists := seen[signature]; exists {
				continue
			}
			seen[signature] = struct{}{}
			sources = append(sources, langKeySourceRef{
				sourceType: "column",
				sourceHigh: tableName,
				sourceLow:  columnName,
			})
		}
	}

	appendTableSource := func(tableName string) {
		if !tableNames[tableName] {
			return
		}
		signature := "table|" + tableName + "|" + tableName
		if _, exists := seen[signature]; exists {
			return
		}
		seen[signature] = struct{}{}
		sources = append(sources, langKeySourceRef{
			sourceType: "table",
			sourceHigh: tableName,
			sourceLow:  tableName,
		})
	}

	appendColumnSources(key)
	appendTableSource(key)

	// The shared naming rule decides what a dynamic key was built from.
	if remainder, ok := lang_key_naming.TrimDynamicPrefix(key); ok {
		appendColumnSources(remainder)
		appendTableSource(remainder)
	}

	if base, ok := lang_key_naming.TrimDynamicSuffix(key); ok {
		appendColumnSources(base)
		appendTableSource(base)
	}

	return sources
}

func datasetOwnedDynamicLangKeyNames(datasetName string) []string {
	return lang_key_naming.DatasetOwnedKeyNames(datasetName)
}
