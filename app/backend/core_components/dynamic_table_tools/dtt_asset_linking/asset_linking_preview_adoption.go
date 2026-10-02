// asset_linking_preview_adoption.go
// Places one stored card-picture reference in storage and keeps a picture as a gallery row.
// Bridges the card picture rule (card_picture_rule.go) with the parent's cached_image value
// and the shared `<parent>_assets` gallery.
// Exists so a card picture that is the only reference to a file on disk becomes a gallery
// row, without copying the file, before a primary picture replaces it on the card.
package dtt_asset_linking

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/dynamic_table_tools/dtt_card_picture"
	media_utils "easelect/backend/core_components/media_utils"

	"github.com/lib/pq"
)

const (
	sharedAssetPreviewColumn = "cached_image"
	// sharedAssetPreviewRecoveredMetadata marks a gallery row that was created from
	// the card picture, so its origin stays recognisable later.
	sharedAssetPreviewRecoveredMetadata = `{"recovered_from":"cached_image"}`
)

// sharedAssetPreviewLocation is where one stored picture lives under the storage root.
type sharedAssetPreviewLocation struct {
	TableUID string
	RowID    int64
	Filename string
}

// resolveSharedAssetPreviewLocation places one stored reference strictly: a flat
// filename, or `<table_uid>/<row_id>/[<variant>/]<file>` with an optional /storage/
// prefix. Other shapes cannot be proven to name a stored file. Placement otherwise
// follows resolveSharedAssetStorageLocation, the rule delete-time file moves use.
func resolveSharedAssetPreviewLocation(value string, parentTableUID string, parentRowID int64) (sharedAssetPreviewLocation, bool) {
	trimmed := strings.TrimSpace(value)
	switch {
	case strings.HasPrefix(trimmed, "/storage/"):
		trimmed = strings.TrimPrefix(trimmed, "/storage/")
	case strings.HasPrefix(trimmed, "storage/"):
		trimmed = strings.TrimPrefix(trimmed, "storage/")
	}
	if trimmed == "" || strings.ContainsAny(trimmed, `\?#`) {
		return sharedAssetPreviewLocation{}, false
	}
	if strings.Contains(trimmed, "/") {
		parts := strings.Split(trimmed, "/")
		if len(parts) != 3 && len(parts) != 4 {
			return sharedAssetPreviewLocation{}, false
		}
		if !media_utils.IsCanonicalStorageID(parts[0]) || !media_utils.IsCanonicalStorageID(parts[1]) {
			return sharedAssetPreviewLocation{}, false
		}
		if len(parts) == 4 && !media_utils.IsKnownVariant(parts[2]) {
			return sharedAssetPreviewLocation{}, false
		}
	}
	tableUID, rowID, filename := resolveSharedAssetStorageLocation(trimmed, parentTableUID, parentRowID)
	if !media_utils.IsCanonicalStorageID(tableUID) || rowID <= 0 || !isPlainStorageFilename(filename) {
		return sharedAssetPreviewLocation{}, false
	}
	return sharedAssetPreviewLocation{TableUID: tableUID, RowID: rowID, Filename: filename}, true
}

// ResolveStoredPictureLocation exposes the card picture rule's strict placement, so
// the missing-media check looks for a card picture exactly where the rule does.
func ResolveStoredPictureLocation(value string, parentTableUID string, parentRowID int64) (tableUID string, rowID int64, filename string, ok bool) {
	location, ok := resolveSharedAssetPreviewLocation(value, parentTableUID, parentRowID)
	return location.TableUID, location.RowID, location.Filename, ok
}

func isPlainStorageFilename(filename string) bool {
	return filename != "" && filename != "." && filename != ".." &&
		!strings.ContainsAny(filename, `/\`) && filename == strings.TrimSpace(filename)
}

// isIndependentMediaReference names a media-library picture. Those live in
// media/<uuid>, survive their usages, and are never moved with a parent's files.
func isIndependentMediaReference(value string) bool {
	trimmed := strings.TrimSpace(value)
	return strings.HasPrefix(trimmed, "/storage/media/") || strings.HasPrefix(trimmed, "media/")
}

func readSharedAssetParentPreview(q dbutils.Querier, parentTable string, parentRowID int64, lock bool) (string, bool, error) {
	query := fmt.Sprintf(
		`SELECT %s::text FROM %s WHERE id = $1`,
		pq.QuoteIdentifier(sharedAssetPreviewColumn),
		pq.QuoteIdentifier(parentTable),
	)
	if lock {
		// FOR NO KEY UPDATE is the lock the following cached_image UPDATE takes
		// anyway. Unlike FOR UPDATE it does not wait on the key-share locks that
		// concurrent gallery inserts hold on this parent, so two uploads cannot deadlock.
		query += ` FOR NO KEY UPDATE`
	}
	var value sql.NullString
	err := q.QueryRow(query, parentRowID).Scan(&value)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return value.String, true, nil
}

// insertAdoptedSharedAssetPreviewRow keeps a card picture as a gallery row with the
// same stored name; no file is copied. The row comes first among the pictures that are
// not primary (the smallest order number less one), so taking the primary mark away
// later makes it the card picture again, as it was before; it is not primary itself
// and records where it came from.
func insertAdoptedSharedAssetPreviewRow(q dbutils.Querier, gallery *dtt_card_picture.PictureRelation, parentRowID int64, value string) error {
	columnTypes, err := readSharedAssetChildColumnTypes(q, gallery.ChildTable)
	if err != nil {
		return err
	}
	childTable := pq.QuoteIdentifier(gallery.ChildTable)
	foreignKey := pq.QuoteIdentifier(gallery.ForeignKey)
	columns := []string{foreignKey, pq.QuoteIdentifier(gallery.FilenameColumn)}
	values := []string{"$1", "$2"}
	args := []interface{}{parentRowID, value}
	addArgument := func(column string, argument interface{}) {
		args = append(args, argument)
		columns = append(columns, pq.QuoteIdentifier(column))
		values = append(values, fmt.Sprintf("$%d", len(args)))
	}
	if isSharedAssetTextColumn(columnTypes["asset_kind"]) {
		addArgument("asset_kind", string(AssetKindImage))
	}
	if columnTypes["is_primary"] == "boolean" {
		addArgument("is_primary", false)
	}
	if isSharedAssetNumberColumn(columnTypes["sort_order"]) {
		columns = append(columns, pq.QuoteIdentifier("sort_order"))
		values = append(values, fmt.Sprintf(
			`COALESCE((SELECT MIN(COALESCE("sort_order", 0)) FROM %s WHERE %s = $1), 1) - 1`,
			childTable,
			foreignKey,
		))
	}
	if columnTypes["metadata_json"] == "jsonb" || columnTypes["metadata_json"] == "json" {
		addArgument("metadata_json", sharedAssetPreviewRecoveredMetadata)
	}

	result, err := q.Exec(
		fmt.Sprintf(`INSERT INTO %s (%s) VALUES (%s)`, childTable, strings.Join(columns, ", "), strings.Join(values, ", ")),
		args...,
	)
	if err != nil {
		return err
	}
	inserted, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if inserted != 1 {
		return fmt.Errorf("inserted %d gallery rows, want 1", inserted)
	}
	return nil
}

func readSharedAssetChildColumnTypes(q dbutils.Querier, childTable string) (map[string]string, error) {
	rows, err := q.Query(
		`SELECT column_name, data_type
		   FROM information_schema.columns
		  WHERE table_schema = 'public'
		    AND table_name = $1`,
		childTable,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	columnTypes := make(map[string]string)
	for rows.Next() {
		var columnName, dataType string
		if err := rows.Scan(&columnName, &dataType); err != nil {
			return nil, err
		}
		columnTypes[columnName] = strings.ToLower(strings.TrimSpace(dataType))
	}
	return columnTypes, rows.Err()
}

func isSharedAssetTextColumn(dataType string) bool {
	return dataType == "text" || dataType == "character varying"
}

func isSharedAssetNumberColumn(dataType string) bool {
	switch dataType {
	case "integer", "bigint", "smallint", "numeric":
		return true
	default:
		return false
	}
}
