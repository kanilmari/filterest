// get_results_limit.go
// Validates an optional small page limit on ordinary dataset reads.
// Connects bounded previews to the existing permission-checked query builder.
// Omitting it preserves the configured page size for all existing callers.
package dtt_1_row_read

import (
	"fmt"
	"net/url"
	"strconv"
)

const maxPreviewResults = 10

// parseResultsLimit accepts one positive decimal integer, capped before query building.
func parseResultsLimit(params url.Values) (int, error) {
	values, present := params["limit"]
	if !present {
		return 0, nil
	}
	if len(values) != 1 || values[0] == "" {
		return 0, fmt.Errorf("limit must be one positive integer")
	}
	for _, digit := range values[0] {
		if digit < '0' || digit > '9' {
			return 0, fmt.Errorf("limit must be one positive integer")
		}
	}
	limit, err := strconv.Atoi(values[0])
	if err != nil || limit < 1 {
		return 0, fmt.Errorf("limit must be one positive integer")
	}
	return min(limit, maxPreviewResults), nil
}
