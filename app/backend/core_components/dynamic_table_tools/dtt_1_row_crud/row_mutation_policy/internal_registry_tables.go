// internal_registry_tables.go
// Names internal registries that are never datasets.
// Shared by automatic registration, consistency checks and dataset deletion.
// Keeps these three boundaries from disagreeing about internal tables.
package row_mutation_policy

import "strings"

var InternalRegistryTables = []string{
	"system_media_assets",
	"system_media_asset_usages",
	"system_row_actor_columns",
}

// IsInternalRegistryTable checks the same list supplied to registry queries.
func IsInternalRegistryTable(tableName string) bool {
	for _, internal := range InternalRegistryTables {
		if strings.EqualFold(tableName, internal) {
			return true
		}
	}
	return false
}
