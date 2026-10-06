// stored_picture_location.go
// Resolves the card-picture rule's canonical storage coordinates and file identity.
// Shared by K121 classification, gallery response authorization and deletion file moves.
// Moved from asset linking to let readers reuse the rule without a handler import cycle.
package dtt_card_picture

import (
	"path/filepath"
	"strconv"
	"strings"

	"easelect/backend/core_components/media_utils"
)

// ResolveStoredPictureLocation strictly places a flat filename or a structured
// <dataset>/<row>/[<variant>/]<file> reference, with an optional storage prefix.
// Query/fragment suffixes select the same file, as the card/article renderers do;
// external addresses and media-library paths cannot name a dataset-row file.
func ResolveStoredPictureLocation(value string, parentTableUID string, parentRowID int64) (string, int64, string, bool) {
	trimmed := strings.TrimSpace(value)
	if suffix := strings.IndexAny(trimmed, "?#"); suffix >= 0 {
		trimmed = trimmed[:suffix]
	}
	switch {
	case strings.HasPrefix(trimmed, "/storage/"):
		trimmed = strings.TrimPrefix(trimmed, "/storage/")
	case strings.HasPrefix(trimmed, "storage/"):
		trimmed = strings.TrimPrefix(trimmed, "storage/")
	}
	if trimmed == "" || strings.ContainsAny(trimmed, `\?#`) {
		return "", 0, "", false
	}
	if strings.Contains(trimmed, "/") {
		parts := strings.Split(trimmed, "/")
		if len(parts) != 3 && len(parts) != 4 {
			return "", 0, "", false
		}
		if !media_utils.IsCanonicalStorageID(parts[0]) || !media_utils.IsCanonicalStorageID(parts[1]) {
			return "", 0, "", false
		}
		if len(parts) == 4 && !media_utils.IsKnownVariant(parts[2]) {
			return "", 0, "", false
		}
	}
	tableUID, rowID, filename := ResolveSharedAssetStorageLocation(trimmed, parentTableUID, parentRowID)
	if !media_utils.IsCanonicalStorageID(tableUID) || rowID <= 0 || !isPlainStorageFilename(filename) {
		return "", 0, "", false
	}
	return tableUID, rowID, filename, true
}

// ResolveSharedAssetStorageLocation retains the historical placement used for
// shared-asset deletion and file moves. Picture classification first validates
// the reference with ResolveStoredPictureLocation rather than guessing ownership.
func ResolveSharedAssetStorageLocation(
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

func isPlainStorageFilename(filename string) bool {
	return filename != "" && filename != "." && filename != ".." &&
		!strings.ContainsAny(filename, `/\`) && filename == strings.TrimSpace(filename)
}
