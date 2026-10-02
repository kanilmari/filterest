// asset_linking_cache_sync.go
// Collects the parent rows a change of gallery rows affects and applies the card picture rule to them.
// Bridges the writers of a parent's gallery (`<parent>_assets` or an older picture relation)
// and the parent's cached_image column.
// Exists so every gallery change — edit, delete, move, marking primary, the media library —
// ends in the one rule of card_picture_rule.go for exactly the parents it touched.
package dtt_asset_linking

import (
	"database/sql"
	"fmt"
	"strings"

	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/dynamic_table_tools/dtt_card_picture"

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
	// ReleasedValues are the stored references of the changed child rows as they
	// were before the change (a deleted, renamed or detached picture). The rule
	// never keeps them as a parent's card picture, so only these may be let go.
	ReleasedValues []string
	// Gallery is the parent's gallery, the relation ChildTable belongs to. A plan
	// built by hand may leave it empty; the resync then looks it up.
	Gallery *dtt_card_picture.PictureRelation
}

// CollectSharedAssetParentCacheSyncPlan resolves the parent rows affected by one change of
// gallery rows. Call it before the change: the plan then also records the references the
// change releases. A child table that is no parent's gallery gives an empty plan.
func CollectSharedAssetParentCacheSyncPlan(q dbutils.Querier, childTable string, childRowIDs []int64) (SharedAssetCacheSyncPlan, error) {
	if q == nil || len(childRowIDs) == 0 {
		return SharedAssetCacheSyncPlan{}, nil
	}

	parentTable, gallery, err := dtt_card_picture.GalleryOf(q, childTable)
	if err != nil {
		return SharedAssetCacheSyncPlan{}, err
	}
	if parentTable == "" || gallery == nil {
		return SharedAssetCacheSyncPlan{}, nil
	}

	parentIDs, releasedValues, err := lookupSharedAssetParentIDs(q, gallery, childRowIDs)
	if err != nil {
		return SharedAssetCacheSyncPlan{}, err
	}

	return SharedAssetCacheSyncPlan{
		ParentTable:      parentTable,
		ChildTable:       childTable,
		ForeignKeyColumn: gallery.ForeignKey,
		ParentRowIDs:     parentIDs,
		ReleasedValues:   releasedValues,
		Gallery:          gallery,
	}, nil
}

// AddCurrentSharedAssetParents extends a plan collected before a child-row edit
// with the parents those rows point at after it. A picture moved to another
// parent then refreshes both the parent it left and the parent it joined.
func AddCurrentSharedAssetParents(q dbutils.Querier, plan SharedAssetCacheSyncPlan, childRowIDs []int64) (SharedAssetCacheSyncPlan, error) {
	if q == nil || plan.ParentTable == "" || plan.Gallery == nil || len(childRowIDs) == 0 {
		return plan, nil
	}
	currentParentIDs, _, err := lookupSharedAssetParentIDs(q, plan.Gallery, childRowIDs)
	if err != nil {
		return plan, err
	}
	plan.ParentRowIDs = dedupeInt64(append(append([]int64(nil), plan.ParentRowIDs...), currentParentIDs...))
	return plan, nil
}

// ResyncSharedAssetParentCache applies the card picture rule to the plan's parents after
// the change. A plan whose child table is not the parent's gallery changes nothing.
func ResyncSharedAssetParentCache(q sharedAssetCacheQueryExecer, plan SharedAssetCacheSyncPlan) error {
	if q == nil || plan.ParentTable == "" || plan.ChildTable == "" || len(plan.ParentRowIDs) == 0 {
		return nil
	}
	gallery := plan.Gallery
	if gallery == nil {
		resolved, err := dtt_card_picture.PictureRelationOf(q, plan.ParentTable)
		if err != nil {
			return err
		}
		gallery = resolved
	}
	if gallery == nil || gallery.ChildTable != plan.ChildTable {
		return nil
	}
	return ApplyCardPictureRule(q, plan.ParentTable, gallery, plan.ParentRowIDs, plan.ReleasedValues)
}

// sameSharedAssetPreviewValue treats NULL and blank as the same empty picture.
func sameSharedAssetPreviewValue(current string, next string) bool {
	if strings.TrimSpace(current) == "" && strings.TrimSpace(next) == "" {
		return true
	}
	return current == next
}

// lookupSharedAssetParentContext returns the parent and foreign key of a shared-asset
// relation of any kind. Delete-time file moves use it: they concern every shared
// relation's files, not only the gallery's pictures.
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

// lookupSharedAssetParentIDs returns the parents of the given gallery rows and the
// references those rows store now, read from the gallery's own stored-name column,
// so a caller collecting before a change knows exactly which values the change releases.
func lookupSharedAssetParentIDs(q dbutils.Querier, gallery *dtt_card_picture.PictureRelation, childRowIDs []int64) ([]int64, []string, error) {
	placeholders := make([]string, 0, len(childRowIDs))
	queryArgs := make([]interface{}, 0, len(childRowIDs))
	for idx, rowID := range childRowIDs {
		placeholders = append(placeholders, fmt.Sprintf("$%d", idx+1))
		queryArgs = append(queryArgs, rowID)
	}

	query := fmt.Sprintf(
		`SELECT %s, %s::text
		   FROM %s
		  WHERE id IN (%s)
		    AND %s IS NOT NULL`,
		pq.QuoteIdentifier(gallery.ForeignKey),
		pq.QuoteIdentifier(gallery.FilenameColumn),
		pq.QuoteIdentifier(gallery.ChildTable),
		strings.Join(placeholders, ", "),
		pq.QuoteIdentifier(gallery.ForeignKey),
	)

	rows, err := q.Query(query, queryArgs...)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()

	parentIDs := make([]int64, 0, len(childRowIDs))
	references := make([]string, 0, len(childRowIDs))
	for rows.Next() {
		var parentID int64
		var reference sql.NullString
		if scanErr := rows.Scan(&parentID, &reference); scanErr != nil {
			return nil, nil, scanErr
		}
		parentIDs = append(parentIDs, parentID)
		if strings.TrimSpace(reference.String) != "" {
			references = append(references, reference.String)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}

	return dedupeInt64(parentIDs), references, nil
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
