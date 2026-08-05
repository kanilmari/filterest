// lang_key_source_resolver.go
// Resolves schema-backed lang-key ownership for exact and dynamic table/column keys.
// Bridges AI-generated missing-key saves and the schema-driven source model in system_lang_key_sources.
// Exists so dynamic dataset keys like add_row_<dataset> inherit the same ownership rules as startup scans.
package lang

import "strings"

type langKeySourceRef struct {
	sourceType string
	sourceHigh string
	sourceLow  string
}

var langKeyDynamicPrefixes = []string{
	"add_row_",
	"search_for_",
	"search_slogan_",
}

var langKeyDynamicSuffixes = []string{
	"_asc",
	"_desc",
	"_front_page",
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

	for _, prefix := range langKeyDynamicPrefixes {
		if !strings.HasPrefix(key, prefix) {
			continue
		}
		remainder := key[len(prefix):]
		appendColumnSources(remainder)
		appendTableSource(remainder)
	}

	for _, suffix := range langKeyDynamicSuffixes {
		if !strings.HasSuffix(key, suffix) {
			continue
		}
		base := key[:len(key)-len(suffix)]
		appendColumnSources(base)
		appendTableSource(base)
	}

	return sources
}

func datasetOwnedDynamicLangKeyNames(datasetName string) []string {
	trimmedDatasetName := strings.TrimSpace(datasetName)
	if trimmedDatasetName == "" {
		return nil
	}
	return []string{
		"add_row_" + trimmedDatasetName,
		"search_for_" + trimmedDatasetName,
		"search_slogan_" + trimmedDatasetName,
		trimmedDatasetName + "_front_page",
	}
}
