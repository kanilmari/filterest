// asset_linking_storage_resolver.go
// Resolves storage keys and base directories for future asset rows.
// Bridges logical asset identity and the current filesystem-oriented storage layout.
// Exists to keep storage-path semantics centralized before provider-specific adapters are added.
package dtt_asset_linking

import (
	"database/sql"
	"fmt"
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
		storageTableUID, storageRowID, normalizedFilename := resolveSharedAssetStorageLocation(
			filename,
			parentTableUID,
			parentRowID,
		)
		moves = append(moves, SharedAssetFileMove{
			StorageTableUID: storageTableUID,
			StorageRowID:    storageRowID,
			Filename:        normalizedFilename,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return moves, nil
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
