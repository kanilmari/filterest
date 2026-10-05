// csv_row_actors.go
// Normalizes actor references in the administrator's CSV restore.
// Connects backup values to current users without restamping restored rows.
// Reports references that no longer identify a signed-in account.
package devtools

import (
	"fmt"
	"strconv"
	"strings"

	"easelect/backend/core_components/dbutils"
)

// CSVActorRepairCounts counts nonempty backup values cleared during restore.
type CSVActorRepairCounts struct {
	Creator int
	Owner   int
}

func normalizeCSVActorValue(q dbutils.Querier, raw string, knownUsers map[int64]bool) (interface{}, bool, error) {
	userID, err := strconv.ParseInt(strings.TrimSpace(raw), 10, 64)
	if err != nil {
		return nil, false, fmt.Errorf("invalid actor reference in CSV: %w", err)
	}
	if userID <= 1 {
		return nil, true, nil
	}
	exists, checked := knownUsers[userID]
	if !checked {
		if err := q.QueryRow(`SELECT EXISTS (SELECT 1 FROM public.system_users WHERE id = $1)`, userID).Scan(&exists); err != nil {
			return nil, false, fmt.Errorf("check restored actor reference: %w", err)
		}
		knownUsers[userID] = exists
	}
	if !exists {
		return nil, true, nil
	}
	return userID, false, nil
}
