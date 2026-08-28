// asset_linking_cache_sync.go
// Recomputes parent cached_image values after shared asset rows change.
// Bridges shared `<parent>_assets` child rows and parent preview cache columns.
// Exists to keep image-selection ordering and cached_image resync logic centralized.
package dtt_asset_linking

import (
	"database/sql"
	"fmt"
	"strings"

	"easelect/backend/core_components/dbutils"

	"github.com/lib/pq"
)

type sharedAssetCacheQueryExecer interface {
	dbutils.Querier
	Exec(query string, args ...interface{}) (sql.Result, error)
}

type SharedAssetCacheSyncPlan struct {
	ParentTable      string
	ChildTable       string
	ForeignKeyColumn string
	ParentRowIDs     []int64
}

// CollectSharedAssetParentCacheSyncPlan resolves the parent rows affected by one shared `_assets` change set.
func CollectSharedAssetParentCacheSyncPlan(q dbutils.Querier, childTable string, childRowIDs []int64) (SharedAssetCacheSyncPlan, error) {
	if q == nil || len(childRowIDs) == 0 {
		return SharedAssetCacheSyncPlan{}, nil
	}

	parentTable, foreignKeyColumn, err := lookupSharedAssetParentContext(q, childTable)
	if err != nil {
		return SharedAssetCacheSyncPlan{}, err
	}
	if parentTable == "" || foreignKeyColumn == "" {
		return SharedAssetCacheSyncPlan{}, nil
	}

	parentIDs, err := lookupSharedAssetParentIDs(q, childTable, foreignKeyColumn, childRowIDs)
	if err != nil {
		return SharedAssetCacheSyncPlan{}, err
	}

	return SharedAssetCacheSyncPlan{
		ParentTable:      parentTable,
		ChildTable:       childTable,
		ForeignKeyColumn: foreignKeyColumn,
		ParentRowIDs:     parentIDs,
	}, nil
}

// ResyncSharedAssetParentCache recalculates cached_image for the affected parents after shared asset changes.
func ResyncSharedAssetParentCache(q sharedAssetCacheQueryExecer, plan SharedAssetCacheSyncPlan) error {
	if q == nil || plan.ParentTable == "" || plan.ChildTable == "" || plan.ForeignKeyColumn == "" || len(plan.ParentRowIDs) == 0 {
		return nil
	}

	hasCachedImage, err := parentTableHasCachedImageColumn(q, plan.ParentTable)
	if err != nil || !hasCachedImage {
		return err
	}

	parentIDs := dedupeInt64(plan.ParentRowIDs)
	imageByParentID, err := fetchPreferredSharedAssetImages(q, plan.ChildTable, plan.ForeignKeyColumn, parentIDs)
	if err != nil {
		return err
	}

	updateQuery := fmt.Sprintf(
		`UPDATE %s SET cached_image = $1 WHERE id = $2`,
		pq.QuoteIdentifier(plan.ParentTable),
	)

	for _, parentID := range parentIDs {
		filename := imageByParentID[parentID]
		var value interface{}
		if strings.TrimSpace(filename) != "" {
			value = filename
		}
		if _, err := q.Exec(updateQuery, value, parentID); err != nil {
			return err
		}
	}

	return nil
}

func lookupSharedAssetParentContext(q dbutils.Querier, childTable string) (string, string, error) {
	rows, err := q.Query(
		`
		SELECT tgt.table_name, fk.source_column_name, fk.target_insert_specs
		FROM system_foreign_key_relations_1_m fk
		JOIN system_db_tables src ON src.table_uid = fk.source_table_uid
		JOIN system_db_tables tgt ON tgt.table_uid = fk.target_table_uid
		WHERE src.table_name = $1
		  AND fk.target_insert_specs->'file_upload' IS NOT NULL
		ORDER BY fk.id ASC
		`,
		childTable,
	)
	if err != nil {
		return "", "", err
	}
	defer rows.Close()

	for rows.Next() {
		var (
			parentTable      string
			foreignKeyColumn string
			specsJSON        []byte
		)
		if scanErr := rows.Scan(&parentTable, &foreignKeyColumn, &specsJSON); scanErr != nil {
			return "", "", scanErr
		}
		config, parseErr := ParseFileUploadConfig(specsJSON)
		if parseErr != nil {
			continue
		}
		if UsesSharedAssetRelation(config) {
			return parentTable, foreignKeyColumn, nil
		}
	}
	if err := rows.Err(); err != nil {
		return "", "", err
	}

	return "", "", nil
}

func lookupSharedAssetParentIDs(q dbutils.Querier, childTable string, foreignKeyColumn string, childRowIDs []int64) ([]int64, error) {
	placeholders := make([]string, 0, len(childRowIDs))
	queryArgs := make([]interface{}, 0, len(childRowIDs))
	for idx, rowID := range childRowIDs {
		placeholders = append(placeholders, fmt.Sprintf("$%d", idx+1))
		queryArgs = append(queryArgs, rowID)
	}

	query := fmt.Sprintf(
		`SELECT DISTINCT %s
		   FROM %s
		  WHERE id IN (%s)
		    AND %s IS NOT NULL`,
		pq.QuoteIdentifier(foreignKeyColumn),
		pq.QuoteIdentifier(childTable),
		strings.Join(placeholders, ", "),
		pq.QuoteIdentifier(foreignKeyColumn),
	)

	rows, err := q.Query(query, queryArgs...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	parentIDs := make([]int64, 0, len(childRowIDs))
	for rows.Next() {
		var parentID int64
		if scanErr := rows.Scan(&parentID); scanErr != nil {
			return nil, scanErr
		}
		parentIDs = append(parentIDs, parentID)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return dedupeInt64(parentIDs), nil
}

func parentTableHasCachedImageColumn(q dbutils.Querier, parentTable string) (bool, error) {
	var exists bool
	err := q.QueryRow(
		`
		SELECT EXISTS (
			SELECT 1
			FROM information_schema.columns
			WHERE table_schema = 'public'
			  AND table_name = $1
			  AND column_name = 'cached_image'
		)
		`,
		parentTable,
	).Scan(&exists)
	return exists, err
}

func fetchPreferredSharedAssetImages(q dbutils.Querier, childTable string, foreignKeyColumn string, parentRowIDs []int64) (map[int64]string, error) {
	if len(parentRowIDs) == 0 {
		return nil, nil
	}

	placeholders := make([]string, 0, len(parentRowIDs))
	queryArgs := make([]interface{}, 0, len(parentRowIDs))
	for idx, rowID := range parentRowIDs {
		placeholders = append(placeholders, fmt.Sprintf("$%d", idx+1))
		queryArgs = append(queryArgs, rowID)
	}

	query := fmt.Sprintf(
		`SELECT %s, filename
		   FROM %s
		  WHERE %s IN (%s)
		    AND COALESCE(NULLIF(TRIM(filename::text), ''), '') <> ''
		    AND COALESCE(NULLIF(TRIM(asset_kind::text), ''), 'image') = 'image'
		  ORDER BY %s,
		           CASE WHEN COALESCE(is_primary, false) THEN 0 ELSE 1 END,
		           sort_order ASC,
		           created ASC,
		           id ASC`,
		pq.QuoteIdentifier(foreignKeyColumn),
		pq.QuoteIdentifier(childTable),
		pq.QuoteIdentifier(foreignKeyColumn),
		strings.Join(placeholders, ", "),
		pq.QuoteIdentifier(foreignKeyColumn),
	)

	rows, err := q.Query(query, queryArgs...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	imageByParentID := make(map[int64]string, len(parentRowIDs))
	for rows.Next() {
		var parentID int64
		var filename string
		if scanErr := rows.Scan(&parentID, &filename); scanErr != nil {
			return nil, scanErr
		}
		if _, exists := imageByParentID[parentID]; exists {
			continue
		}
		imageByParentID[parentID] = filename
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return imageByParentID, nil
}

func dedupeInt64(values []int64) []int64 {
	if len(values) == 0 {
		return nil
	}

	seen := make(map[int64]bool, len(values))
	deduped := make([]int64, 0, len(values))
	for _, value := range values {
		if seen[value] {
			continue
		}
		seen[value] = true
		deduped = append(deduped, value)
	}
	return deduped
}
