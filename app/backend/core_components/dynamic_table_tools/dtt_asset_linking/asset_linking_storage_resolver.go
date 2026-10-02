// asset_linking_storage_resolver.go
// Resolves storage keys and base directories for future asset rows.
// Bridges logical asset identity and the current filesystem-oriented storage layout.
// Exists to keep storage-path semantics centralized before provider-specific adapters are added.
package dtt_asset_linking

import (
	"database/sql"
	"fmt"
	"log"
	"path/filepath"
	"strconv"
	"strings"

	"easelect/backend/core_components/dbutils"
)

// BuildFilesystemBaseDir returns the current local-storage base directory for one parent row.
func BuildFilesystemBaseDir(baseDir string, tableUID string, parentRowID int64) string {
	return filepath.Join(baseDir, tableUID, fmt.Sprintf("%d", parentRowID))
}

// BuildFilesystemAssetKey returns the current filename convention used for child-uploaded assets.
func BuildFilesystemAssetKey(tableUID string, parentRowID int64, childRowID int64, extension string) string {
	return fmt.Sprintf("%s_%d_%d%s", tableUID, parentRowID, childRowID, extension)
}

type SharedAssetParentStorageContext struct {
	ParentTable    string
	ParentTableUID string
	ParentRowID    int64
}

type SharedAssetFileMove struct {
	StorageTableUID string
	StorageRowID    int64
	Filename        string
	// ParentRowID is the parent the deleted row belonged to; its remaining rows
	// and preview decide whether the file is still referenced.
	ParentRowID int64
}

// ResolveSharedAssetParentStorageContext returns the canonical parent-based storage coordinates
// for a direct upload into a shared `<parent>_assets` table.
func ResolveSharedAssetParentStorageContext(
	q dbutils.Querier,
	childTableName string,
	referencingColumn string,
	storedReferenceValue interface{},
) (SharedAssetParentStorageContext, error) {
	if q == nil {
		return SharedAssetParentStorageContext{}, nil
	}

	parentRowID, ok := coerceStorageReferenceToInt64(storedReferenceValue)
	if !ok || parentRowID <= 0 {
		return SharedAssetParentStorageContext{}, nil
	}

	parentTable, foreignKeyColumn, err := lookupSharedAssetParentContext(q, childTableName)
	if err != nil {
		return SharedAssetParentStorageContext{}, err
	}
	if parentTable == "" {
		return SharedAssetParentStorageContext{}, nil
	}
	if strings.TrimSpace(referencingColumn) != "" && strings.TrimSpace(foreignKeyColumn) != "" && referencingColumn != foreignKeyColumn {
		return SharedAssetParentStorageContext{}, nil
	}

	var parentTableUID string
	err = q.QueryRow(
		`SELECT table_uid FROM system_db_tables WHERE table_name = $1`,
		parentTable,
	).Scan(&parentTableUID)
	if err != nil {
		if err == sql.ErrNoRows {
			return SharedAssetParentStorageContext{}, nil
		}
		return SharedAssetParentStorageContext{}, err
	}

	return SharedAssetParentStorageContext{
		ParentTable:    parentTable,
		ParentTableUID: parentTableUID,
		ParentRowID:    parentRowID,
	}, nil
}

// CollectSharedAssetFileMoves resolves which canonical shared-asset files should move out of
// live storage when individual `_assets` rows are deleted.
func CollectSharedAssetFileMoves(q dbutils.Querier, childTable string, childRowIDs []int64) ([]SharedAssetFileMove, error) {
	if q == nil || len(childRowIDs) == 0 {
		return nil, nil
	}

	parentTable, foreignKeyColumn, err := lookupSharedAssetParentContext(q, childTable)
	if err != nil {
		return nil, err
	}
	if parentTable == "" || foreignKeyColumn == "" {
		return nil, nil
	}

	var parentTableUID string
	err = q.QueryRow(
		`SELECT table_uid FROM system_db_tables WHERE table_name = $1`,
		parentTable,
	).Scan(&parentTableUID)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}

	placeholders := make([]string, 0, len(childRowIDs))
	queryArgs := make([]interface{}, 0, len(childRowIDs))
	for idx, rowID := range childRowIDs {
		placeholders = append(placeholders, fmt.Sprintf("$%d", idx+1))
		queryArgs = append(queryArgs, rowID)
	}

	query := fmt.Sprintf(
		`SELECT %s, filename
		   FROM %s
		  WHERE id IN (%s)
		    AND COALESCE(NULLIF(TRIM(filename::text), ''), '') <> ''`,
		pqQuoteIdentifier(foreignKeyColumn),
		pqQuoteIdentifier(childTable),
		strings.Join(placeholders, ", "),
	)

	rows, err := q.Query(query, queryArgs...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	moves := make([]SharedAssetFileMove, 0, len(childRowIDs))
	for rows.Next() {
		var parentRowID int64
		var filename string
		if scanErr := rows.Scan(&parentRowID, &filename); scanErr != nil {
			return nil, scanErr
		}
		if strings.TrimSpace(filename) == "" {
			continue
		}
		// Independent shared media must survive parent and usage deletion.
		if isIndependentMediaReference(filename) {
			continue
		}
		storageTableUID, storageRowID, normalizedFilename := resolveSharedAssetStorageLocation(
			filename,
			parentTableUID,
			parentRowID,
		)
		moves = append(moves, SharedAssetFileMove{
			StorageTableUID: storageTableUID,
			StorageRowID:    storageRowID,
			Filename:        normalizedFilename,
			ParentRowID:     parentRowID,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return moves, nil
}

// OmitStillReferencedSharedAssetFileMoves drops planned moves whose file is still
// named by a remaining row of the same parent (in any of its upload relations) or
// by the parent's card picture after the resync. Since a kept card picture
// can share its stored name with another row, deleting one row must not take a
// file another reference still shows. Call it after the delete and the resync,
// inside the same transaction. It never fails the delete: when the references
// cannot be read, no shared-asset file is moved and each stays in live storage.
func OmitStillReferencedSharedAssetFileMoves(q dbutils.Querier, childTable string, moves []SharedAssetFileMove) []SharedAssetFileMove {
	if q == nil || len(moves) == 0 {
		return moves
	}
	if _, err := q.Exec(`SAVEPOINT shared_asset_file_references`); err != nil {
		log.Printf("[shared asset files] kept %d planned file moves in live storage: savepoint unavailable: %v", len(moves), err)
		return nil
	}
	kept, err := omitStillReferencedSharedAssetFileMoves(q, childTable, moves)
	if err != nil {
		if _, rollbackErr := q.Exec(`ROLLBACK TO SAVEPOINT shared_asset_file_references`); rollbackErr == nil {
			_, _ = q.Exec(`RELEASE SAVEPOINT shared_asset_file_references`)
		}
		log.Printf("[shared asset files] kept %d planned file moves in live storage: %v", len(moves), err)
		return nil
	}
	if _, err := q.Exec(`RELEASE SAVEPOINT shared_asset_file_references`); err != nil {
		log.Printf("[shared asset files] kept %d planned file moves in live storage: savepoint release failed: %v", len(moves), err)
		return nil
	}
	return kept
}

func omitStillReferencedSharedAssetFileMoves(q dbutils.Querier, childTable string, moves []SharedAssetFileMove) ([]SharedAssetFileMove, error) {
	parentTable, _, err := lookupSharedAssetParentContext(q, childTable)
	if err != nil {
		return nil, err
	}
	if parentTable == "" {
		return moves, nil
	}
	hasPreview, err := parentTableHasCachedImageColumn(q, parentTable)
	if err != nil {
		return nil, err
	}

	referencedByParent := make(map[int64]map[sharedAssetPreviewLocation]bool)
	kept := make([]SharedAssetFileMove, 0, len(moves))
	for _, move := range moves {
		if move.ParentRowID <= 0 {
			kept = append(kept, move)
			continue
		}
		referenced, loaded := referencedByParent[move.ParentRowID]
		if !loaded {
			// Every row of every upload relation of the parent counts, whatever its
			// kind, the same references the card picture rule reads.
			references, parentTableUID, err := ReadParentPictureReferences(q, parentTable, move.ParentRowID)
			if err != nil {
				return nil, err
			}
			if hasPreview {
				preview, found, err := readSharedAssetParentPreview(q, parentTable, move.ParentRowID, false)
				if err != nil {
					return nil, err
				}
				if found {
					references = append(references, preview)
				}
			}
			// Resolve with the rule the move itself was planned with, so an
			// equivalent spelling of the same file also counts as a reference.
			referenced = make(map[sharedAssetPreviewLocation]bool, len(references))
			for _, reference := range references {
				if strings.TrimSpace(reference) == "" || isIndependentMediaReference(reference) {
					continue
				}
				storageTableUID, storageRowID, filename := resolveSharedAssetStorageLocation(reference, parentTableUID, move.ParentRowID)
				referenced[sharedAssetPreviewLocation{TableUID: storageTableUID, RowID: storageRowID, Filename: filename}] = true
			}
			referencedByParent[move.ParentRowID] = referenced
		}
		location := sharedAssetPreviewLocation{TableUID: move.StorageTableUID, RowID: move.StorageRowID, Filename: move.Filename}
		if referenced[location] {
			log.Printf("[shared asset files] kept %s/%d/%s in live storage: another reference of %s row %d still uses it", move.StorageTableUID, move.StorageRowID, move.Filename, parentTable, move.ParentRowID)
			continue
		}
		kept = append(kept, move)
	}
	return kept, nil
}

func coerceStorageReferenceToInt64(value interface{}) (int64, bool) {
	switch typed := value.(type) {
	case int:
		return int64(typed), true
	case int32:
		return int64(typed), true
	case int64:
		return typed, true
	case float64:
		return int64(typed), true
	case string:
		parsed, err := strconv.ParseInt(strings.TrimSpace(typed), 10, 64)
		if err != nil {
			return 0, false
		}
		return parsed, true
	case []byte:
		parsed, err := strconv.ParseInt(strings.TrimSpace(string(typed)), 10, 64)
		if err != nil {
			return 0, false
		}
		return parsed, true
	default:
		return 0, false
	}
}

// ResolveSharedAssetStorageLocation exposes the canonical mapping from a stored
// asset reference to its live storage coordinates, so readers such as the
// missing-media-files check resolve a path exactly the way deletion does.
// It accepts the retired flat filename form (`<table_uid>_<row_id>_<child_id>.ext`)
// as well as a structured `<table_uid>/<row_id>/...` reference, and falls back to
// the caller's parent coordinates when the value carries none of its own.
func ResolveSharedAssetStorageLocation(
	storedFilename string,
	defaultTableUID string,
	defaultRowID int64,
) (string, int64, string) {
	return resolveSharedAssetStorageLocation(storedFilename, defaultTableUID, defaultRowID)
}

func resolveSharedAssetStorageLocation(
	storedFilename string,
	defaultTableUID string,
	defaultRowID int64,
) (string, int64, string) {
	trimmedFilename := strings.TrimSpace(storedFilename)
	leafFilename := strings.TrimSpace(filepath.Base(trimmedFilename))
	if leafFilename == "." {
		leafFilename = trimmedFilename
	}

	if tableUID, rowID, ok := parseStorageCoordinatesFromStructuredPath(trimmedFilename); ok {
		return tableUID, rowID, leafFilename
	}
	if tableUID, rowID, ok := parseStorageCoordinatesFromFlatFilename(leafFilename); ok {
		return tableUID, rowID, leafFilename
	}

	return defaultTableUID, defaultRowID, leafFilename
}

func parseStorageCoordinatesFromStructuredPath(storedFilename string) (string, int64, bool) {
	trimmedFilename := strings.TrimSpace(storedFilename)
	if !strings.Contains(trimmedFilename, "/") {
		return "", 0, false
	}

	pathParts := strings.Split(trimmedFilename, "/")
	if len(pathParts) < 3 {
		return "", 0, false
	}

	rowID, err := strconv.ParseInt(strings.TrimSpace(pathParts[1]), 10, 64)
	if err != nil || rowID <= 0 {
		return "", 0, false
	}

	tableUID := strings.TrimSpace(pathParts[0])
	if tableUID == "" {
		return "", 0, false
	}

	return tableUID, rowID, true
}

func parseStorageCoordinatesFromFlatFilename(filename string) (string, int64, bool) {
	trimmedFilename := strings.TrimSpace(filename)
	filenameParts := strings.SplitN(trimmedFilename, "_", 3)
	if len(filenameParts) < 3 {
		return "", 0, false
	}

	rowID, err := strconv.ParseInt(strings.TrimSpace(filenameParts[1]), 10, 64)
	if err != nil || rowID <= 0 {
		return "", 0, false
	}

	tableUID := strings.TrimSpace(filenameParts[0])
	if tableUID == "" {
		return "", 0, false
	}

	return tableUID, rowID, true
}

func pqQuoteIdentifier(identifier string) string {
	return `"` + strings.ReplaceAll(identifier, `"`, `""`) + `"`
}
