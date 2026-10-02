// gallery_order.go
// States the one order of a row's gallery pictures — the picture marked primary first,
// then the order number, the creation time and the id — and which gallery rows are pictures.
// Between every reader and writer of a row's card picture: the rule that chooses it,
// the read-time card enrichment, the article's gallery rows and the startup alignment.
// Exists so each is written once; a second copy is how a card and its gallery came
// to disagree about which picture is first (owner decision K120, 30.9.2026).
package dtt_card_picture

import (
	"fmt"
	"strings"

	"github.com/lib/pq"
)

// qualifiedColumn quotes a column, qualified by tableAlias when it is not empty.
func qualifiedColumn(tableAlias string, column string) string {
	if strings.TrimSpace(tableAlias) == "" {
		return pq.QuoteIdentifier(column)
	}
	return pq.QuoteIdentifier(tableAlias) + "." + pq.QuoteIdentifier(column)
}

// PictureCondition is the SQL condition that a row of this gallery is a picture: it
// names a stored file and, where the relation has asset kinds, its kind is an image —
// an empty kind counts as one. tableAlias qualifies the columns when it is not empty.
func (relation PictureRelation) PictureCondition(tableAlias string) string {
	condition := fmt.Sprintf(`COALESCE(NULLIF(TRIM(%s::text), ''), '') <> ''`, qualifiedColumn(tableAlias, relation.FilenameColumn))
	if relation.HasAssetKind {
		condition += ` AND COALESCE(NULLIF(TRIM(` + qualifiedColumn(tableAlias, "asset_kind") + `::text), ''), 'image') = 'image'`
	}
	return condition
}

// GalleryColumns says which ordering columns a gallery table has. Shared-asset tables
// have all of them; an older single-purpose table may lack some.
type GalleryColumns struct {
	IsPrimary bool
	SortOrder bool
	Created   bool
	ID        bool
}

// GalleryOrderClause returns the ORDER BY terms of the gallery order, without the
// keyword, qualified by tableAlias when it is not empty. An empty order number counts
// as 0, the column's default; a row without a creation time counts as older than any
// dated row, so a new row is last by time even in a table without order numbers; the
// id decides the rest, so the order is total.
func GalleryOrderClause(columns GalleryColumns, tableAlias string) string {
	qualify := func(column string) string { return qualifiedColumn(tableAlias, column) }
	terms := make([]string, 0, 4)
	if columns.IsPrimary {
		terms = append(terms, "CASE WHEN COALESCE("+qualify("is_primary")+", false) THEN 0 ELSE 1 END")
	}
	if columns.SortOrder {
		terms = append(terms, "COALESCE("+qualify("sort_order")+", 0) ASC")
	}
	if columns.Created {
		terms = append(terms, qualify("created")+" ASC NULLS FIRST")
	}
	if columns.ID {
		terms = append(terms, qualify("id")+" ASC")
	}
	return strings.Join(terms, ", ")
}
