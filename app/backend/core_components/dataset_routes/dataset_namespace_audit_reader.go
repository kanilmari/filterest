// dataset_namespace_audit_reader.go
// Supplies preserved namespace-audit rows to the administrator alias editor.
// Connects migration reason keys to the existing authorized management snapshot.
// Keeps disabled aliases out of the ordinary active-name catalogue.
package dataset_routes

import (
	"easelect/backend/core_components/dbutils"
	"fmt"
)

type DisabledDatasetAlias struct {
	AliasSlug string `json:"alias_slug"`
	ReasonKey string `json:"reason_key"`
}

func loadDisabledDatasetAliases(q dbutils.Querier) (map[int][]DisabledDatasetAlias, error) {
	rows, err := q.Query(`SELECT table_uid, alias_slug, disabled_reason
        FROM system_db_table_aliases WHERE is_active IS FALSE AND disabled_reason IS NOT NULL ORDER BY id`)
	if err != nil {
		return nil, fmt.Errorf("load disabled dataset aliases: %w", err)
	}
	defer rows.Close()
	result := make(map[int][]DisabledDatasetAlias)
	for rows.Next() {
		var uid int
		var alias DisabledDatasetAlias
		if err := rows.Scan(&uid, &alias.AliasSlug, &alias.ReasonKey); err != nil {
			return nil, err
		}
		result[uid] = append(result[uid], alias)
	}
	return result, rows.Err()
}
