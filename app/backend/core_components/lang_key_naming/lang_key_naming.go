// lang_key_naming.go
// Defines how a dynamically generated language key is named and recognised.
// Bridges the startup source scan, the runtime ownership resolver and every
// place that builds a dataset's own keys.
// Exists so one rule describes these names: the scan and the runtime resolver
// used to carry separate copies of the same list, which had to agree by hand.
package lang_key_naming

import "strings"

// dynamicPrefixes are the beginnings the interface joins to a dataset or column
// name, for example add_row_customers or search_for_name.
var dynamicPrefixes = []string{
	"add_row_",
	"search_for_",
	"search_slogan_",
}

// dynamicSuffixes are the endings the interface joins to a dataset or column
// name, for example name_asc or customers_front_page.
var dynamicSuffixes = []string{
	"_asc",
	"_desc",
	"_front_page",
}

// DynamicPrefixes returns the recognised beginnings. The copy keeps a caller
// from changing the shared rule by accident.
func DynamicPrefixes() []string {
	return append([]string(nil), dynamicPrefixes...)
}

// DynamicSuffixes returns the recognised endings, copied for the same reason.
func DynamicSuffixes() []string {
	return append([]string(nil), dynamicSuffixes...)
}

// TrimDynamicPrefix reports the name a key was built from, when the key begins
// with one of the recognised beginnings.
func TrimDynamicPrefix(langKey string) (string, bool) {
	for _, prefix := range dynamicPrefixes {
		if strings.HasPrefix(langKey, prefix) {
			return langKey[len(prefix):], true
		}
	}
	return "", false
}

// TrimDynamicSuffix reports the name a key was built from, when the key ends
// with one of the recognised endings.
func TrimDynamicSuffix(langKey string) (string, bool) {
	for _, suffix := range dynamicSuffixes {
		if strings.HasSuffix(langKey, suffix) {
			return langKey[:len(langKey)-len(suffix)], true
		}
	}
	return "", false
}

// SearchPlaceholderKey names a dataset's own search placeholder.
func SearchPlaceholderKey(datasetName string) string {
	return "search_for_" + strings.TrimSpace(datasetName)
}

// DatasetOwnedKeyNames lists the keys a dataset owns by name alone. Dropping the
// dataset removes them, even when their recorded source is generic.
func DatasetOwnedKeyNames(datasetName string) []string {
	trimmed := strings.TrimSpace(datasetName)
	if trimmed == "" {
		return nil
	}
	return []string{
		"add_row_" + trimmed,
		SearchPlaceholderKey(trimmed),
		"search_slogan_" + trimmed,
		trimmed + "_front_page",
	}
}
