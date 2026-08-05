// storage_reference_normalization.go
// Normalizes persisted storage references into canonical dataset, row, and filename identities.
// Bridges historical filename-only values with current /storage URL and variant layouts.
// Exists so authorization compares identities only after rejecting traversal and ambiguous paths.
package dtt_1_row_read

import (
	"net/url"
	"path"
	"strconv"
	"strings"
)

func storageReferenceMatches(storedReference, defaultTableUID string, defaultRowID int64, request StorageReadRequest) bool {
	tableUID, rowID, filename, ok := normalizeStorageReference(storedReference, defaultTableUID, defaultRowID)
	return ok && tableUID == request.TableUID && rowID == request.ParentRowID && filename == request.Filename
}

func normalizeStorageReference(storedReference, defaultTableUID string, defaultRowID int64) (string, int64, string, bool) {
	normalized := strings.TrimSpace(storedReference)
	if normalized == "" || !isCanonicalPositiveID(defaultTableUID) || defaultRowID <= 0 {
		return "", 0, "", false
	}

	parsed, err := url.Parse(normalized)
	if err != nil {
		return "", 0, "", false
	}
	if parsed.IsAbs() || parsed.Host != "" {
		if !strings.HasPrefix(parsed.Path, "/storage/") {
			return "", 0, "", false
		}
		normalized = parsed.Path
	} else if parsed.RawQuery != "" || parsed.Fragment != "" {
		normalized = parsed.Path
	}
	normalized = strings.TrimSpace(normalized)
	if strings.Contains(normalized, `\`) {
		return "", 0, "", false
	}
	switch {
	case strings.HasPrefix(normalized, "/storage/"):
		normalized = strings.TrimPrefix(normalized, "/storage/")
	case strings.HasPrefix(normalized, "storage/"):
		normalized = strings.TrimPrefix(normalized, "storage/")
	case strings.HasPrefix(normalized, "./storage/"):
		normalized = strings.TrimPrefix(normalized, "./storage/")
	case strings.HasPrefix(normalized, "/") || strings.HasPrefix(normalized, "./"):
		return "", 0, "", false
	}

	parts := strings.Split(normalized, "/")
	for _, segment := range parts {
		if segment == "." || segment == ".." {
			return "", 0, "", false
		}
	}
	cleaned := path.Clean(normalized)
	if cleaned != normalized || cleaned == "." || cleaned == ".." || strings.HasPrefix(cleaned, "../") {
		return "", 0, "", false
	}

	filename := path.Base(cleaned)
	if filename == "." || filename == ".." || filename == "" {
		return "", 0, "", false
	}
	tableUID := defaultTableUID
	rowID := defaultRowID
	if len(parts) == 3 || len(parts) == 4 {
		if !isCanonicalPositiveID(parts[0]) {
			return "", 0, "", false
		}
		parsedRowID, err := strconv.ParseInt(parts[1], 10, 64)
		if err != nil || parsedRowID <= 0 || strconv.FormatInt(parsedRowID, 10) != parts[1] {
			return "", 0, "", false
		}
		if len(parts) == 4 && !isSupportedStorageVariant(parts[2]) {
			return "", 0, "", false
		}
		return parts[0], parsedRowID, filename, true
	}
	if len(parts) != 1 {
		return "", 0, "", false
	}

	filenameParts := strings.SplitN(filename, "_", 3)
	if len(filenameParts) == 3 && isCanonicalPositiveID(filenameParts[0]) {
		parsedRowID, err := strconv.ParseInt(filenameParts[1], 10, 64)
		if err == nil && parsedRowID > 0 && strconv.FormatInt(parsedRowID, 10) == filenameParts[1] {
			tableUID = filenameParts[0]
			rowID = parsedRowID
		}
	}

	return tableUID, rowID, filename, true
}

func isSupportedStorageVariant(value string) bool {
	switch value {
	case "original", "300", "1000", "2160":
		return true
	default:
		return false
	}
}

func isCanonicalPositiveID(value string) bool {
	parsed, err := strconv.ParseInt(value, 10, 64)
	return err == nil && parsed > 0 && strconv.FormatInt(parsed, 10) == value
}
