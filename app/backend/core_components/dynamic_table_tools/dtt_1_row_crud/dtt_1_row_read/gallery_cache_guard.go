// gallery_cache_guard.go
// Authorizes existing gallery-derived caches independently of optional enrichment.
// Relation metadata and filename classification stay server-side; visible rows use the caller.
// Preserves K121 kept pictures and never fills a cache after the guard removes it.
package dtt_1_row_read

import (
	"fmt"
	"strings"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/dynamic_table_tools/dtt_card_picture"
	dtt_models "easelect/backend/core_components/dynamic_table_tools/dtt_models"
	"github.com/lib/pq"
)

func prepareRowsForCardResponse(q dbutils.Querier, table string, rows []map[string]interface{}, columns map[int]dtt_models.ColumnInfo, visible []string, actor dbutils.RequestActorContext, enrich bool) error {
	gallery := &cardGalleryRead{}
	if enrich {
		logCardSupportEnrichmentWarning(table, enrichRowsWithCardSupportColumns(q, table, rows, columns, visible, actor, gallery))
	}
	return guardGalleryCachedImages(q, table, rows, actor, gallery)
}

func guardGalleryCachedImages(q dbutils.Querier, table string, rows []map[string]interface{}, actor dbutils.RequestActorContext, gallery *cardGalleryRead) error {
	var cachedRows []map[string]interface{}
	for _, row := range rows {
		if normalizeCardSupportValue(row["cached_image"]) != "" {
			cachedRows = append(cachedRows, row)
		}
	}
	if len(cachedRows) == 0 {
		return nil
	}
	// Use the existing owning relation-metadata connection for classification,
	// even if the caller cannot SELECT the gallery. Only parent-bound file references
	// are read; normalization and ownership classification stay in the K121 resolver.
	metadata := q
	if backend.Db != nil {
		metadata = backend.Db
	}
	if gallery == nil {
		gallery = &cardGalleryRead{}
	}
	err := gallery.discover(metadata, table)
	if err != nil || gallery.relation == nil {
		return err
	}
	matching, err := readMatchingGalleryFilenames(metadata, *gallery.relation, cachedRows, gallery.parentTableUID)
	if err != nil {
		return err
	}
	if len(matching) == 0 {
		return nil
	}
	images, _ := gallery.visibleImages(q, collectCardSupportRowIDs(cachedRows), actor)
	// Permission/content failures cannot rescue a gallery-derived cache through
	// the metadata connection. Independent media still passes its own response guard.
	filterGalleryCachedImages(cachedRows, matching, images, gallery.parentTableUID)
	return nil
}

func readMatchingGalleryFilenames(q dbutils.Querier, relation dtt_card_picture.PictureRelation, parents []map[string]interface{}, parentTableUID string) (map[string][]string, error) {
	var placeholders []string
	var args []interface{}
	identities := map[int64]string{}
	for _, row := range parents {
		id, ok := coerceCardSupportRowID(row["id"])
		if !ok {
			continue
		}
		identity, own := ownGalleryPictureIdentity(normalizeCardSupportValue(row["cached_image"]), parentTableUID, id)
		if !own {
			continue
		}
		identities[id] = identity
		args = append(args, id)
		placeholders = append(placeholders, fmt.Sprintf("$%d", len(args)))
	}
	matching := map[string][]string{}
	if len(placeholders) == 0 {
		return matching, nil
	}
	// Read only file references of parents with an own-folder cache. Normalize in
	// Go through K121 once rather than duplicating its placement rules in SQL.
	query := fmt.Sprintf("SELECT %s,%s FROM %s WHERE %s IN (%s) AND %s", pq.QuoteIdentifier(relation.ForeignKey), pq.QuoteIdentifier(relation.FilenameColumn), pq.QuoteIdentifier(relation.ChildTable), pq.QuoteIdentifier(relation.ForeignKey), strings.Join(placeholders, ","), relation.PictureCondition(""))
	result, err := q.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer result.Close()
	for result.Next() {
		var id int64
		var filename string
		if err := result.Scan(&id, &filename); err != nil {
			return nil, err
		}
		if identity, own := ownGalleryPictureIdentity(filename, parentTableUID, id); own && identity == identities[id] {
			key := fmt.Sprint(id)
			matching[key] = append(matching[key], filename)
		}
	}
	return matching, result.Err()
}
