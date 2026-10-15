// get_results_effective_sort.go
// Resolves the physical primary column behind the chosen Newest mode.
// Connects SQL ordering and get-results metadata through one fallback policy.
// Keeps secondary id ordering out of the table header's primary sort indication.
package dtt_1_row_read

import (
	"net/url"
	"strings"

	dtt_models "easelect/backend/core_components/dynamic_table_tools/dtt_models"
)

// EffectiveSort describes only the primary order; nil means no physical Newest column.
type EffectiveSort struct {
	Column    string `json:"column"`
	Direction string `json:"direction"`
}

func resolveSemanticNewestSort(columns map[string]dtt_models.ColumnInfo, direction string) *EffectiveSort {
	direction = strings.ToUpper(direction)
	if direction != "ASC" && direction != "DESC" {
		direction = "DESC"
	}
	for _, candidate := range []string{"created", "created_at", "applied_at", "id"} {
		if _, exists := columns[candidate]; exists {
			return &EffectiveSort{Column: candidate, Direction: direction}
		}
	}
	return nil
}

// effectiveNewestSort is response metadata for Newest only; explicit sorts keep their own UI state.
func effectiveNewestSort(params url.Values, columns map[int]dtt_models.ColumnInfo) *EffectiveSort {
	if params.Get("sort_column") != semanticNewestSortColumn {
		return nil
	}
	return resolveSemanticNewestSort(buildColumnsByName(columns), params.Get("sort_order"))
}
