// import_table_csv_pictures.go
// Keeps card pictures consistent when the CSV restore writes a gallery or a row that has one.
// Between the restore's row-by-row upsert and the card picture rule of dtt_asset_linking.
// Exists because a restore writes rows with its own statement: without these calls it would
// skip the rule, place restored pictures anywhere and overwrite a card picture that is the
// only reference to a stored file (owner decisions K120 and K121, 30.9.2026).
package devtools

import (
	"database/sql"
	"fmt"
	"strconv"
	"strings"

	links "easelect/backend/core_components/dynamic_table_tools/dtt_asset_linking"
	"easelect/backend/core_components/dynamic_table_tools/dtt_card_picture"
)

// csvPictureRestore is what one restore needs to know about pictures. A table can be a
// parent's gallery, have a gallery of its own, both, or neither.
type csvPictureRestore struct {
	table string
	// gallery is set when the table is a parent's gallery.
	gallery *dtt_card_picture.PictureRelation
	// ownGallery is set when the table has a gallery and a cached_image column.
	ownGallery       *dtt_card_picture.PictureRelation
	idIndex          int
	cachedImageIndex int
	// orderGiven is true when the CSV carries sort_order: restored positions are kept.
	orderGiven bool
}

func newCSVPictureRestore(tx *sql.Tx, table string, columns []string) (*csvPictureRestore, error) {
	restore := &csvPictureRestore{table: table, idIndex: -1, cachedImageIndex: -1}
	for index, column := range columns {
		switch column {
		case "id":
			restore.idIndex = index
		case "cached_image":
			restore.cachedImageIndex = index
		case "sort_order":
			restore.orderGiven = true
		}
	}
	_, gallery, err := dtt_card_picture.GalleryOf(tx, table)
	if err != nil {
		return nil, fmt.Errorf("find the gallery %s belongs to: %w", table, err)
	}
	restore.gallery = gallery
	if restore.cachedImageIndex >= 0 {
		ownGallery, err := dtt_card_picture.PictureRelationOf(tx, table)
		if err != nil {
			return nil, fmt.Errorf("find the gallery of %s: %w", table, err)
		}
		restore.ownGallery = ownGallery
	}
	return restore, nil
}

func (restore *csvPictureRestore) active() bool {
	return restore.gallery != nil || restore.ownGallery != nil
}

func (restore *csvPictureRestore) recordID(record []string) (int64, bool) {
	if restore.idIndex < 0 || restore.idIndex >= len(record) {
		return 0, false
	}
	id, err := strconv.ParseInt(strings.TrimSpace(record[restore.idIndex]), 10, 64)
	return id, err == nil && id > 0
}

// beforeRow runs before one row is written. For a gallery row that already exists it
// collects the parent it belongs to now and the picture it releases. For a row with a
// gallery whose card picture the restore would replace, the stored picture is handled as
// a replaced value (links.ResolveRestoredCardPicture): kept as a gallery row first when it
// is an only copy in the row's own folder, or, when the rule keeps it, written back in
// place of the restored value, which is logged as a conflict. values are the statement's
// arguments and are changed in place.
func (restore *csvPictureRestore) beforeRow(tx *sql.Tx, record []string, values []interface{}) (links.SharedAssetCacheSyncPlan, error) {
	id, identified := restore.recordID(record)
	if !identified {
		return links.SharedAssetCacheSyncPlan{}, nil
	}
	var plan links.SharedAssetCacheSyncPlan
	if restore.gallery != nil {
		collected, err := links.CollectSharedAssetParentCacheSyncPlan(tx, restore.table, []int64{id})
		if err != nil {
			return plan, err
		}
		plan = collected
	}
	if restore.ownGallery != nil && restore.cachedImageIndex < len(record) {
		keep, stored, err := links.ResolveRestoredCardPicture(tx, restore.table, restore.ownGallery, id, record[restore.cachedImageIndex])
		if err != nil {
			return plan, err
		}
		if keep {
			values[restore.cachedImageIndex] = stored
		}
	}
	return plan, nil
}

// afterRow runs after one row is written. A newly inserted gallery row goes after the
// parent's other pictures unless the CSV gave its position; a gallery row that existed
// refreshes the parent it left and the one it joined; a row with a gallery has its
// restored card picture checked by the rule.
func (restore *csvPictureRestore) afterRow(tx *sql.Tx, id int64, inserted bool, plan links.SharedAssetCacheSyncPlan) error {
	if restore.gallery != nil {
		if inserted || plan.ParentTable == "" {
			if err := links.SettleNewGalleryRows(tx, restore.table, []int64{id}, restore.orderGiven || !inserted); err != nil {
				return err
			}
		} else {
			current, err := links.AddCurrentSharedAssetParents(tx, plan, []int64{id})
			if err != nil {
				return err
			}
			if err := links.ResyncSharedAssetParentCache(tx, current); err != nil {
				return err
			}
		}
	}
	if restore.ownGallery != nil {
		if err := links.ApplyCardPictureRule(tx, restore.table, restore.ownGallery, []int64{id}, nil); err != nil {
			return err
		}
	}
	return nil
}
