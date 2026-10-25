// column_visibility_cache.go
// Evicts every result cache derived from a dataset's delivery flags.
// Connects committed card, generic metadata and CSV writes to cached readers.
// Keeps all users/views safe without flushing settings on presentation-only saves.
package dtt_1_row_read

import (
	"strings"

	"easelect/backend/core_components/runtime_grant_mutations"
)

func init() {
	runtime_grant_mutations.RegisterColumnVisibilityCacheInvalidator(invalidateColumnVisibilityCaches)
}

func invalidateColumnVisibilityCaches(tableName string) {
	InvalidateSchemaCache(tableName) // Also advances the cross-dataset join generation.
	ucsCacheMu.Lock()
	defer ucsCacheMu.Unlock()
	ucsGenerations[tableName]++
	for key := range ucsCache {
		parts := strings.Split(key, "|")
		if len(parts) == 4 && parts[2] == tableName {
			delete(ucsCache, key)
		}
	}
}
