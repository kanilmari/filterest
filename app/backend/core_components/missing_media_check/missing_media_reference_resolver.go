// missing_media_reference_resolver.go
// Turns one stored media reference into the storage paths that could hold its file.
// Between the per-dataset asset rows and the storage directory the server reads from.
// Exists so the check looks in exactly the places the application itself would look,
// including the retired flat filenames that older installations still store.
package missing_media_check

import (
	"path"
	"strconv"
	"strings"

	links "easelect/backend/core_components/dynamic_table_tools/dtt_asset_linking"
	"easelect/backend/core_components/media_library"
	media_utils "easelect/backend/core_components/media_utils"
)

// storageVariantFolders are the folders one picture is stored in. A row's picture
// is still visible as long as any one of them holds the file, because the storage
// route falls back between sizes, so "missing" means none of them has it.
var storageVariantFolders = append([]string{media_utils.OriginalVariant}, media_utils.SizedVariants...)

// ResolvedReference is where one stored reference should have its files.
type ResolvedReference struct {
	// RelativePaths are storage-root-relative candidates, most likely first.
	RelativePaths []string
	// OwnerFolder is the `<table_uid>/<row_id>` folder that owns the file, or
	// `media/<uuid>` for an independent media-library asset.
	OwnerFolder string
	// Filename is the leaf name inside each variant folder.
	Filename string
	// Legacy marks a reference stored as a retired flat filename.
	Legacy bool
	// MediaLibrary marks an independent shared asset outside the parent's folder.
	MediaLibrary bool
}

// ResolveReference maps one stored value to its candidate storage paths.
// It returns ok=false for a value this installation cannot place at all; the
// caller reports that as missing rather than failing the run.
func ResolveReference(storedValue string, parentTableUID string, parentRowID int64) (ResolvedReference, bool) {
	trimmed := strings.TrimSpace(storedValue)
	if trimmed == "" {
		return ResolvedReference{}, false
	}

	if isMediaLibraryReference(trimmed) {
		assetID, _, filename, ok := media_library.ParseStoragePath(strings.TrimPrefix(trimmed, "/storage/"))
		if !ok {
			return ResolvedReference{}, false
		}
		owner := path.Join("media", assetID)
		return ResolvedReference{
			RelativePaths: buildVariantPaths(owner, filename),
			OwnerFolder:   owner,
			Filename:      filename,
			MediaLibrary:  true,
		}, true
	}

	tableUID, rowID, filename := links.ResolveSharedAssetStorageLocation(trimmed, parentTableUID, parentRowID)
	if !isCanonicalStorageID(tableUID) || rowID <= 0 || !isSafeStorageFilename(filename) {
		return ResolvedReference{}, false
	}
	owner := path.Join(tableUID, strconv.FormatInt(rowID, 10))
	return ResolvedReference{
		RelativePaths: buildVariantPaths(owner, filename),
		OwnerFolder:   owner,
		Filename:      filename,
		Legacy:        isLegacyFlatFilename(trimmed),
	}, true
}

func isMediaLibraryReference(value string) bool {
	return strings.HasPrefix(value, "/storage/media/") || strings.HasPrefix(value, "media/")
}

// isLegacyFlatFilename reports the retired `<table_uid>_<row_id>_<child_id>.ext`
// form, which carries its own coordinates but no folder path.
func isLegacyFlatFilename(value string) bool {
	if strings.Contains(value, "/") {
		return false
	}
	parts := strings.SplitN(value, "_", 3)
	if len(parts) < 3 {
		return false
	}
	if !isCanonicalStorageID(parts[0]) {
		return false
	}
	rowID, err := strconv.ParseInt(parts[1], 10, 64)
	return err == nil && rowID > 0
}

func buildVariantPaths(ownerFolder string, filename string) []string {
	paths := make([]string, 0, len(storageVariantFolders))
	for _, variant := range storageVariantFolders {
		paths = append(paths, path.Join(ownerFolder, variant, filename))
	}
	return paths
}

func isCanonicalStorageID(value string) bool {
	parsed, err := strconv.ParseInt(value, 10, 64)
	return err == nil && parsed > 0 && strconv.FormatInt(parsed, 10) == value
}

// isSafeStorageFilename keeps a hand-edited database value from steering the
// check outside the storage root.
func isSafeStorageFilename(filename string) bool {
	if filename == "" || filename == "." || filename == ".." {
		return false
	}
	if strings.ContainsAny(filename, `/\`) {
		return false
	}
	return filename == strings.TrimSpace(filename)
}
