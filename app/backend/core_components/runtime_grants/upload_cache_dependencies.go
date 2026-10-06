// upload_cache_dependencies.go
// Loads the predicate column used by configured upload-cache writes.
// Connects row_cache_saver.go's target_column_name to narrow SELECT requirements.
// Reads after closing relation rows so one transaction needs no second connection.
package runtime_grants

import (
	"context"
	"database/sql"
	"fmt"
)

type uploadCacheDependency struct {
	row, source, parent, destination int64
	column                           string
}

func loadUploadCachePredicates(ctx context.Context, tx *sql.Tx, snapshot *GrantSnapshot, caches []uploadCacheDependency) error {
	for _, cache := range caches {
		var predicate sql.NullString
		if err := tx.QueryRowContext(ctx, `SELECT target_column_name FROM public.system_foreign_key_relations_1_m WHERE id=$1`, cache.row).Scan(&predicate); err != nil {
			return fmt.Errorf("read cache predicate: %w", err)
		}
		if !predicate.Valid || !snapshot.Objects[cache.parent].hasColumn(predicate.String) || !snapshot.Objects[cache.destination].hasColumn(predicate.String) {
			metadataFinding(snapshot, "system_foreign_key_relations_1_m", fmt.Sprintf("id %d", cache.row), "blocker", "missing cache target_column_name on relation target or cache destination")
			continue
		}
		// row_cache_saver.go delegates the parent's preview to the gallery rule.
		if cache.parent == cache.destination && cache.column == "cached_image" && predicate.String == "id" {
			continue
		}
		snapshot.Dependencies = append(snapshot.Dependencies, Dependency{SourceOID: cache.source, TargetOID: cache.destination,
			Kind: "cache", When: Insert, Columns: []string{cache.column}, ReadColumns: []string{predicate.String}})
	}
	return nil
}
