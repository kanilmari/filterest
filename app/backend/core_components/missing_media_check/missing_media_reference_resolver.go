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
	media_utils "easelect/backend/core_components/media_utils"
)

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

// ResolveReference maps one stored gallery value to its candidate storage paths: by
// the placement delete-time file moves use (ResolveSharedAssetStorageLocation), after
// the storage route's /storage/ prefix is removed, so a file is looked for where the
// route serves it from. It returns ok=false for a value this installation cannot place
// at all; the caller reports that as missing rather than failing the run.
func ResolveReference(storedValue string, parentTableUID string, parentRowID int64) (ResolvedReference, bool) {
	trimmed := strings.TrimSpace(storedValue)
	if trimmed == "" {
		return ResolvedReference{}, false
	}

	if isMediaLibraryReference(trimmed) {
		return resolveMediaLibraryReference(trimmed)
	}

	tableUID, rowID, filename := links.ResolveSharedAssetStorageLocation(withoutStoragePrefix(trimmed), parentTableUID, parentRowID)
	return rowFolderReference(trimmed, tableUID, rowID, filename)
}

// withoutStoragePrefix removes the storage route's address prefix, so
// `/storage/117/5/original/photo.jpg` names folder 117/5.
func withoutStoragePrefix(value string) string {
	for _, prefix := range []string{"/storage/", "storage/"} {
		if strings.HasPrefix(value, prefix) {
			return strings.TrimPrefix(value, prefix)
		}
	}
	return value
}

// ResolveCardPictureReference places a picture field's value — a card picture or an
// image field — the strict way the card picture rule does: a /storage/ prefix is read
// and other shapes stay unresolved. The check and the writer therefore never disagree
// about where a card picture lives. Gallery rows keep ResolveReference.
func ResolveCardPictureReference(storedValue string, parentTableUID string, parentRowID int64) (ResolvedReference, bool) {
	trimmed := strings.TrimSpace(storedValue)
	if trimmed == "" {
		return ResolvedReference{}, false
	}
	if isMediaLibraryReference(trimmed) {
		return resolveMediaLibraryReference(trimmed)
	}
	tableUID, rowID, filename, ok := links.ResolveStoredPictureLocation(trimmed, parentTableUID, parentRowID)
	if !ok {
		return ResolvedReference{}, false
	}
	return rowFolderReference(trimmed, tableUID, rowID, filename)
}

func resolveMediaLibraryReference(trimmed string) (ResolvedReference, bool) {
	assetID, _, filename, ok := media_utils.ParseMediaLibraryStoragePath(strings.TrimPrefix(trimmed, "/storage/"))
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

func rowFolderReference(trimmed string, tableUID string, rowID int64, filename string) (ResolvedReference, bool) {
	if !media_utils.IsCanonicalStorageID(tableUID) || rowID <= 0 || !isSafeStorageFilename(filename) {
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
	if !media_utils.IsCanonicalStorageID(parts[0]) {
		return false
	}
	rowID, err := strconv.ParseInt(parts[1], 10, 64)
	return err == nil && rowID > 0
}

// buildVariantPaths lists the folders one picture is stored in. A row's picture is
// still visible as long as any one of them holds the file, because the storage route
// falls back between sizes, so "missing" means none of them has it. The list is the
// shared storage layout rule, also used before a card preview is replaced.
func buildVariantPaths(ownerFolder string, filename string) []string {
	return media_utils.VariantRelativePaths(ownerFolder, filename)
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
