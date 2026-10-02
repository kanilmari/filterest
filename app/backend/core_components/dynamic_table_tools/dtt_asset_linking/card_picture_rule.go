// card_picture_rule.go
// Stores a row's card picture (cached_image) by the one rule every writer follows.
// Between every writer of a gallery — upload, edit, delete, move, marking primary, the media
// library, restores, automations and the startup alignment — and the parent's cached_image.
// Exists so the card picture is chosen in one place: the precedence of
// dtt_card_picture.ChooseCardPicture, applied under the parent row's lock, with a picture
// that would otherwise be lost kept first as a gallery row (owner decisions K120 and K121,
// 30.9.2026). Before this, an upload wrote its own name and the next gallery change chose
// again by another rule, so a card's picture could switch back by itself.
package dtt_asset_linking

import (
	"database/sql"
	"fmt"
	"log"
	"path"
	"sort"
	"strconv"
	"strings"

	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/dynamic_table_tools/dtt_card_picture"
	media_utils "easelect/backend/core_components/media_utils"
	"easelect/backend/core_components/runtimepaths"

	"github.com/lib/pq"
)

const cardPictureSavepoint = "card_picture_rule"

// cardPictureLockWaitMillis bounds how long a writer waits for a parent row that another
// transaction holds, so a request never hangs behind a long transaction. A wait that runs
// out leaves the card picture as it is; the row's next change or the startup alignment
// brings it to the rule.
const cardPictureLockWaitMillis = 5000

// withParentLockWait runs work with the transaction's lock wait (lock_timeout) at most
// cardPictureLockWaitMillis and then puts the previous value back. A shorter wait the
// caller chose, such as the startup alignment's, stays as it is.
func withParentLockWait(q dbutils.Querier, work func() error) error {
	var currentMillis int64
	if err := q.QueryRow(`SELECT setting::bigint FROM pg_settings WHERE name = 'lock_timeout'`).Scan(&currentMillis); err != nil {
		return err
	}
	if currentMillis > 0 && currentMillis <= cardPictureLockWaitMillis {
		return work()
	}
	if _, err := q.Exec(`SELECT set_config('lock_timeout', $1, true)`, strconv.Itoa(cardPictureLockWaitMillis)); err != nil {
		return err
	}
	workErr := work()
	_, restoreErr := q.Exec(`SELECT set_config('lock_timeout', $1, true)`, strconv.FormatInt(currentMillis, 10))
	if workErr != nil {
		return workErr
	}
	return restoreErr
}

// cardPictureFileState looks at one storage-root-relative path. Production reads the
// configured storage root on every call; tests replace it.
var cardPictureFileState = func(relativePath string) media_utils.StoredFileStatus {
	return media_utils.StoredFileState(runtimepaths.Current().StorageRoot)(relativePath)
}

// ApplyCardPictureRule stores the card picture of each parent row by the one rule.
// gallery is the parent's gallery (dtt_card_picture.PictureRelationOf); releasedValues are
// references the operation gives up on purpose (a deleted, renamed or detached row, or an
// administrator clearing the field), which are never kept or adopted. Parents are handled
// in ascending id order, so writers that touch the same parents wait for each other
// instead of deadlocking. When a row's pictures cannot be read or a picture cannot be
// kept, that row's card picture stays as it is and the caller's work goes on; only a
// failed write of the chosen value is returned.
func ApplyCardPictureRule(
	q sharedAssetCacheQueryExecer,
	parentTable string,
	gallery *dtt_card_picture.PictureRelation,
	parentRowIDs []int64,
	releasedValues []string,
) error {
	if q == nil || gallery == nil || strings.TrimSpace(parentTable) == "" || len(parentRowIDs) == 0 {
		return nil
	}
	hasCachedImage, err := parentTableHasCachedImageColumn(q, parentTable)
	if err != nil || !hasCachedImage {
		return err
	}

	parentIDs := dedupeInt64(parentRowIDs)
	sort.Slice(parentIDs, func(left, right int) bool { return parentIDs[left] < parentIDs[right] })
	updateQuery := fmt.Sprintf(`UPDATE %s SET cached_image = $1 WHERE id = $2`, pq.QuoteIdentifier(parentTable))
	for _, parentRowID := range parentIDs {
		value, write := decideCardPicture(q, parentTable, gallery, parentRowID, releasedValues)
		if !write {
			continue
		}
		var stored interface{}
		if strings.TrimSpace(value) != "" {
			stored = value
		}
		if _, err := q.Exec(updateQuery, stored, parentRowID); err != nil {
			return err
		}
	}
	return nil
}

// decideCardPicture reads, classifies and, when the choice replaces an adoptable
// picture, keeps it as a gallery row, all behind a savepoint in the caller's
// transaction. write is false when nothing changes or anything failed.
func decideCardPicture(
	q sharedAssetCacheQueryExecer,
	parentTable string,
	gallery *dtt_card_picture.PictureRelation,
	parentRowID int64,
	releasedValues []string,
) (string, bool) {
	if _, err := q.Exec(`SAVEPOINT ` + cardPictureSavepoint); err != nil {
		log.Printf("[card picture] left %s row %d unchanged: savepoint unavailable: %v", parentTable, parentRowID, err)
		return "", false
	}
	value, write, err := evaluateCardPicture(q, parentTable, gallery, parentRowID, releasedValues)
	if err != nil {
		// A failed statement poisons the transaction; rolling back to the savepoint
		// keeps the caller's own work committable, only without this card picture.
		if _, rollbackErr := q.Exec(`ROLLBACK TO SAVEPOINT ` + cardPictureSavepoint); rollbackErr == nil {
			_, _ = q.Exec(`RELEASE SAVEPOINT ` + cardPictureSavepoint)
		}
		log.Printf("[card picture] left %s row %d unchanged: %v", parentTable, parentRowID, err)
		return "", false
	}
	if _, err := q.Exec(`RELEASE SAVEPOINT ` + cardPictureSavepoint); err != nil {
		log.Printf("[card picture] left %s row %d unchanged: savepoint release failed: %v", parentTable, parentRowID, err)
		return "", false
	}
	return value, write
}

func evaluateCardPicture(
	q sharedAssetCacheQueryExecer,
	parentTable string,
	gallery *dtt_card_picture.PictureRelation,
	parentRowID int64,
	releasedValues []string,
) (string, bool, error) {
	// Lock before every deciding look, "nothing changes" included: a look without the
	// lock can see the gallery before another writer's change commits, and two deletes at
	// once could then leave a deleted picture on the card. FOR NO KEY UPDATE does not wait
	// on the key-share locks that concurrent gallery inserts hold on this parent.
	var current string
	var found bool
	err := withParentLockWait(q, func() (err error) {
		current, found, err = readSharedAssetParentPreview(q, parentTable, parentRowID, true)
		return err
	})
	if err != nil || !found {
		return "", false, err
	}
	choice, err := chooseCardPictureFor(q, parentTable, gallery, parentRowID, current, releasedValues)
	if err != nil {
		return "", false, err
	}
	if choice.AdoptCurrent {
		if err := insertAdoptedSharedAssetPreviewRow(q, gallery, parentRowID, current); err != nil {
			return "", false, fmt.Errorf("keep the card picture as a gallery row: %w", err)
		}
		log.Printf("[card picture] kept %s row %d picture %q as the first %s gallery row before the primary replaced it", parentTable, parentRowID, current, gallery.ChildTable)
	}
	if sameSharedAssetPreviewValue(current, choice.Value) {
		return "", false, nil
	}
	return choice.Value, true, nil
}

func chooseCardPictureFor(
	q dbutils.Querier,
	parentTable string,
	gallery *dtt_card_picture.PictureRelation,
	parentRowID int64,
	current string,
	releasedValues []string,
) (dtt_card_picture.Choice, error) {
	pictures, err := readGalleryPictures(q, gallery, parentRowID)
	if err != nil {
		return dtt_card_picture.Choice{}, fmt.Errorf("read the gallery: %w", err)
	}
	class := dtt_card_picture.CurrentNone
	if trimmed := strings.TrimSpace(current); trimmed != "" && !isReleasedCardPicture(trimmed, releasedValues) {
		references, parentTableUID, err := ReadParentPictureReferences(q, parentTable, parentRowID)
		if err != nil {
			return dtt_card_picture.Choice{}, fmt.Errorf("read the parent's picture references: %w", err)
		}
		class, _ = ClassifyCardPicture(trimmed, references, parentTableUID, parentRowID, gallery.Shared, cardPictureFileState)
	}
	return dtt_card_picture.ChooseCardPicture(strings.TrimSpace(current), class, pictures), nil
}

func isReleasedCardPicture(current string, releasedValues []string) bool {
	for _, released := range releasedValues {
		if strings.TrimSpace(released) == current {
			return true
		}
	}
	return false
}

// ClassifyCardPicture says what the card's current picture is when the rule considers
// replacing it. references are the stored references of every row of every file-upload
// relation of the parent, of any kind: a picture one of them carries is not the card's
// own. canAdopt is true when the gallery can keep a picture as a row (a shared-asset
// relation). fileState must answer Unknown, never Missing, when it could not look. It
// only reads, so the missing-media check classifies exactly as the writer does.
func ClassifyCardPicture(
	current string,
	references []string,
	parentTableUID string,
	parentRowID int64,
	canAdopt bool,
	fileState func(relativePath string) media_utils.StoredFileStatus,
) (dtt_card_picture.CurrentClass, string) {
	trimmed := strings.TrimSpace(current)
	if trimmed == "" {
		return dtt_card_picture.CurrentNone, "no picture"
	}
	for _, reference := range references {
		if strings.TrimSpace(reference) == trimmed {
			return dtt_card_picture.CurrentNone, "a gallery row carries it"
		}
	}
	if isIndependentMediaReference(trimmed) {
		// The library keeps its files while any row uses them; a file that is
		// certainly gone is broken like any other.
		assetID, _, filename, ok := media_utils.ParseMediaLibraryStoragePath(strings.TrimPrefix(trimmed, "/storage/"))
		if !ok {
			return dtt_card_picture.CurrentBroken, "names no media-library picture"
		}
		libraryFolder := path.Join("media", assetID)
		if media_utils.StoredPictureState(media_utils.VariantRelativePaths(libraryFolder, filename), fileState) == media_utils.StoredFileMissing {
			return dtt_card_picture.CurrentBroken, "no file in any size folder of " + libraryFolder
		}
		return dtt_card_picture.CurrentKept, "a media-library picture; the library keeps its files"
	}
	if IsExternalPictureAddress(trimmed) {
		return dtt_card_picture.CurrentKept, "an external address, which cannot be checked"
	}
	location, ok := resolveSharedAssetPreviewLocation(trimmed, parentTableUID, parentRowID)
	if !ok {
		return dtt_card_picture.CurrentBroken, "names neither a stored file nor an address"
	}
	for _, reference := range references {
		if other, ok := resolveSharedAssetPreviewLocation(reference, parentTableUID, parentRowID); ok && other == location {
			return dtt_card_picture.CurrentNone, "a gallery row carries the same file"
		}
	}
	ownerFolder := path.Join(location.TableUID, strconv.FormatInt(location.RowID, 10))
	switch media_utils.StoredPictureState(media_utils.VariantRelativePaths(ownerFolder, location.Filename), fileState) {
	case media_utils.StoredFileMissing:
		return dtt_card_picture.CurrentBroken, "no file in any size folder"
	case media_utils.StoredFileUnknown:
		return dtt_card_picture.CurrentKept, "the file could not be checked"
	}
	if location.TableUID != parentTableUID || location.RowID != parentRowID {
		return dtt_card_picture.CurrentKept, "the only reference to a picture in folder " + ownerFolder
	}
	if !canAdopt {
		return dtt_card_picture.CurrentKept, "an own-folder picture this gallery cannot keep as a row"
	}
	return dtt_card_picture.CurrentAdoptable, "the only reference to a stored picture"
}

// IsExternalPictureAddress names a picture outside this installation's storage: an
// address that names no stored file and cannot be checked. The missing-media check uses
// the same answer.
func IsExternalPictureAddress(value string) bool {
	lowered := strings.ToLower(strings.TrimSpace(value))
	return strings.HasPrefix(lowered, "https://") || strings.HasPrefix(lowered, "http://") || strings.HasPrefix(lowered, "//")
}

// ReadParentPictureReferences returns the stored references of every row of every
// file-upload relation of one parent row, whatever the row's kind, and the parent's
// table_uid that places flat names. A file any of them names is still in use.
func ReadParentPictureReferences(q dbutils.Querier, parentTable string, parentRowID int64) ([]string, string, error) {
	parentTableUID, err := LookupParentTableUID(q, parentTable)
	if err != nil {
		return nil, "", fmt.Errorf("look up %s: %w", parentTable, err)
	}
	statuses, err := ListFileUploadRelationStatuses(q, parentTable)
	if err != nil {
		return nil, "", err
	}
	references := make([]string, 0)
	seen := make(map[string]bool, len(statuses))
	for _, status := range statuses {
		filenameColumn := strings.TrimSpace(status.UploadConfig.FilenameColumn)
		if filenameColumn == "" {
			filenameColumn = "filename"
		}
		key := status.ChildTable + "." + status.ForeignKeyColumn + "." + filenameColumn
		if seen[key] || strings.TrimSpace(status.ChildTable) == "" || strings.TrimSpace(status.ForeignKeyColumn) == "" {
			continue
		}
		seen[key] = true
		quotedColumn := pq.QuoteIdentifier(filenameColumn)
		rows, err := q.Query(
			fmt.Sprintf(`SELECT %s::text FROM %s WHERE %s = $1 AND %s IS NOT NULL`,
				quotedColumn, pq.QuoteIdentifier(status.ChildTable), pq.QuoteIdentifier(status.ForeignKeyColumn), quotedColumn),
			parentRowID,
		)
		if err != nil {
			return nil, "", err
		}
		for rows.Next() {
			var reference string
			if err := rows.Scan(&reference); err != nil {
				rows.Close()
				return nil, "", err
			}
			references = append(references, reference)
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return nil, "", err
		}
	}
	return references, strconv.Itoa(parentTableUID), nil
}

// readGalleryPictures returns one parent's gallery pictures in the gallery order.
func readGalleryPictures(q dbutils.Querier, gallery *dtt_card_picture.PictureRelation, parentRowID int64) ([]dtt_card_picture.GalleryPicture, error) {
	filename := pq.QuoteIdentifier(gallery.FilenameColumn)
	primary := "false"
	if gallery.Columns.IsPrimary {
		primary = `COALESCE("is_primary", false)`
	}
	query := fmt.Sprintf(
		`SELECT %s::text, %s FROM %s WHERE %s = $1 AND %s`,
		filename, primary, pq.QuoteIdentifier(gallery.ChildTable), pq.QuoteIdentifier(gallery.ForeignKey), gallery.PictureCondition(""),
	)
	if order := dtt_card_picture.GalleryOrderClause(gallery.Columns, ""); order != "" {
		query += ` ORDER BY ` + order
	}
	rows, err := q.Query(query, parentRowID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	pictures := make([]dtt_card_picture.GalleryPicture, 0)
	for rows.Next() {
		var picture dtt_card_picture.GalleryPicture
		if err := rows.Scan(&picture.Value, &picture.Primary); err != nil {
			return nil, err
		}
		pictures = append(pictures, picture)
	}
	return pictures, rows.Err()
}

// SettleNewGalleryRows places newly created rows of a gallery after the parent's other
// pictures, unless the creator chose their order, and applies the card picture rule to
// their parents. Rows of a table that is no parent's gallery are left alone. Every
// creator of gallery rows calls it: adding a row (directly or as a new row's child), the
// media library, a restore and an automation.
func SettleNewGalleryRows(q sharedAssetCacheQueryExecer, childTable string, childRowIDs []int64, orderChosen bool) error {
	if q == nil || len(childRowIDs) == 0 {
		return nil
	}
	parentTable, gallery, err := dtt_card_picture.GalleryOf(q, childTable)
	if err != nil || parentTable == "" || gallery == nil {
		return err
	}
	if !orderChosen {
		if err := AppendGalleryRows(q, parentTable, gallery, childRowIDs); err != nil {
			return fmt.Errorf("place new %s rows last: %w", childTable, err)
		}
	}
	parentIDs, _, err := lookupSharedAssetParentIDs(q, gallery, childRowIDs)
	if err != nil {
		return err
	}
	return ApplyCardPictureRule(q, parentTable, gallery, parentIDs, nil)
}

// ResolveRestoredCardPicture decides, before a restore writes a parent row, whether the
// restore may replace the row's stored card picture. The stored picture is treated as a
// replaced value under the rule: an only copy in the row's own folder is kept as a gallery
// row first, and the restored value may then be written. A picture the rule keeps — and
// an only copy that could not be kept as a row — is never overwritten: keep is true and
// the stored value must be written instead, and the conflict is logged with the value the
// restore brought. An empty restored value is no administrator's release. Read errors are
// returned and stop the restore, so nothing is written on a guess.
func ResolveRestoredCardPicture(
	q sharedAssetCacheQueryExecer,
	parentTable string,
	gallery *dtt_card_picture.PictureRelation,
	parentRowID int64,
	restored string,
) (keep bool, stored string, err error) {
	if q == nil || gallery == nil {
		return false, "", nil
	}
	var found bool
	err = withParentLockWait(q, func() (lockErr error) {
		stored, found, lockErr = readSharedAssetParentPreview(q, parentTable, parentRowID, true)
		return lockErr
	})
	if err != nil || !found || strings.TrimSpace(stored) == "" || sameSharedAssetPreviewValue(stored, restored) {
		return false, stored, err
	}
	references, parentTableUID, err := ReadParentPictureReferences(q, parentTable, parentRowID)
	if err != nil {
		return false, stored, err
	}
	class, reason := ClassifyCardPicture(stored, references, parentTableUID, parentRowID, gallery.Shared, cardPictureFileState)
	switch class {
	case dtt_card_picture.CurrentKept:
		log.Printf("[card picture] restore conflict: kept %s row %d picture %q (%s); the restored value %q was not written", parentTable, parentRowID, stored, reason, restored)
		return true, stored, nil
	case dtt_card_picture.CurrentAdoptable:
		if _, err := q.Exec(`SAVEPOINT ` + cardPictureSavepoint); err != nil {
			return false, stored, err
		}
		if adoptErr := insertAdoptedSharedAssetPreviewRow(q, gallery, parentRowID, strings.TrimSpace(stored)); adoptErr != nil {
			if _, err := q.Exec(`ROLLBACK TO SAVEPOINT ` + cardPictureSavepoint); err != nil {
				return false, stored, err
			}
			_, _ = q.Exec(`RELEASE SAVEPOINT ` + cardPictureSavepoint)
			log.Printf("[card picture] restore conflict: kept %s row %d picture %q, which could not become a gallery row (%v); the restored value %q was not written", parentTable, parentRowID, stored, adoptErr, restored)
			return true, stored, nil
		}
		if _, err := q.Exec(`RELEASE SAVEPOINT ` + cardPictureSavepoint); err != nil {
			return false, stored, err
		}
		log.Printf("[card picture] kept %s row %d picture %q as the first %s gallery row before a restore replaced it", parentTable, parentRowID, stored, gallery.ChildTable)
	}
	return false, stored, nil
}

// ApplyCardPictureRuleForGalleryRows applies the rule to the parents of gallery rows
// whose stored file name has just arrived: an upload saves its file after its row was
// created. It does not depend on the upload settings' cache targets, so an older picture
// relation without them follows the rule too. Rows of a table that is no parent's
// gallery change nothing.
func ApplyCardPictureRuleForGalleryRows(q sharedAssetCacheQueryExecer, childTable string, childRowIDs []int64) error {
	if q == nil || len(childRowIDs) == 0 {
		return nil
	}
	parentTable, gallery, err := dtt_card_picture.GalleryOf(q, childTable)
	if err != nil || parentTable == "" || gallery == nil {
		return err
	}
	parentIDs, _, err := lookupSharedAssetParentIDs(q, gallery, childRowIDs)
	if err != nil {
		return err
	}
	return ApplyCardPictureRule(q, parentTable, gallery, parentIDs, nil)
}

// ApplyCardPictureRuleToNewRows applies the rule to newly created rows of a dataset that
// has a gallery. A first card picture their creator supplied is taken as the current
// value and follows the rule like any other, also when no picture row came with it.
func ApplyCardPictureRuleToNewRows(q sharedAssetCacheQueryExecer, table string, rowIDs []int64) error {
	if q == nil || len(rowIDs) == 0 {
		return nil
	}
	gallery, err := dtt_card_picture.PictureRelationOf(q, table)
	if err != nil || gallery == nil {
		return err
	}
	return ApplyCardPictureRule(q, table, gallery, rowIDs, nil)
}

// AppendGalleryRows places newly created gallery rows after every other picture of
// their parent, in the order given (creation order), unless the creator chose a
// position itself. The parent row is locked first, so concurrent appends to one parent
// wait for each other: the first to arrive stays first. The wait is bounded; when it
// runs out, the creation fails as a whole instead of placing a row out of order. Without
// an order-number column the rows' creation time already places them last.
func AppendGalleryRows(q dbutils.Querier, parentTable string, gallery *dtt_card_picture.PictureRelation, childRowIDs []int64) error {
	if q == nil || gallery == nil || !gallery.Columns.SortOrder || strings.TrimSpace(parentTable) == "" {
		return nil
	}
	return withParentLockWait(q, func() error {
		return appendGalleryRows(q, parentTable, gallery, childRowIDs)
	})
}

func appendGalleryRows(q dbutils.Querier, parentTable string, gallery *dtt_card_picture.PictureRelation, childRowIDs []int64) error {
	childTable := pq.QuoteIdentifier(gallery.ChildTable)
	foreignKey := pq.QuoteIdentifier(gallery.ForeignKey)
	for _, childRowID := range childRowIDs {
		var parentRowID sql.NullInt64
		if err := q.QueryRow(fmt.Sprintf(`SELECT %s FROM %s WHERE id = $1`, foreignKey, childTable), childRowID).Scan(&parentRowID); err != nil {
			if err == sql.ErrNoRows {
				continue
			}
			return err
		}
		if !parentRowID.Valid {
			continue
		}
		var locked int64
		if err := q.QueryRow(fmt.Sprintf(`SELECT id FROM %s WHERE id = $1 FOR NO KEY UPDATE`, pq.QuoteIdentifier(parentTable)), parentRowID.Int64).Scan(&locked); err != nil {
			if err == sql.ErrNoRows {
				continue
			}
			return err
		}
		if _, err := q.Exec(fmt.Sprintf(
			`UPDATE %s SET "sort_order" = (SELECT COALESCE(MAX(COALESCE("sort_order", 0)), -1) + 1 FROM %s WHERE %s = $1 AND id <> $2) WHERE id = $2`,
			childTable, childTable, foreignKey,
		), parentRowID.Int64, childRowID); err != nil {
			return err
		}
	}
	return nil
}
