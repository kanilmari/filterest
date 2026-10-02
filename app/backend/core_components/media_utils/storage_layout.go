// storage_layout.go
// Names the storage-root folder rules shared by media writers, storage cleanup, and the missing-media check.
// Bridges the on-disk layout <table_uid>/<row_id>/<variant>/<file> with code that probes, keeps, or prunes it.
// Exists so "which folders belong to a dataset" and "where can one picture live" are each decided once.
package media_utils

import (
	"errors"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"

	"github.com/google/uuid"
)

// StorageVariantFolders lists every folder one stored picture can live in, original first.
var StorageVariantFolders = append([]string{OriginalVariant}, SizedVariants...)

// VariantRelativePaths returns the storage-root-relative places where one file of
// an owner folder (`<table_uid>/<row_id>` or `media/<uuid>`) can be stored,
// original first. A picture is still on disk while any one of them exists,
// because storage delivery falls back between sizes.
func VariantRelativePaths(ownerFolder string, filename string) []string {
	paths := make([]string, 0, len(StorageVariantFolders))
	for _, variant := range StorageVariantFolders {
		paths = append(paths, path.Join(ownerFolder, variant, filename))
	}
	return paths
}

// IsCanonicalStorageID reports whether value is a positive integer written the one
// canonical way: no sign, no leading zeros, no spaces. Dataset folders (table_uid)
// and their row folders are named this way, so a storage-root folder with any other
// name belongs to something else, such as the shared image library in media/.
func IsCanonicalStorageID(value string) bool {
	parsed, err := strconv.ParseInt(value, 10, 64)
	return err == nil && parsed > 0 && strconv.FormatInt(parsed, 10) == value
}

// ParseMediaLibraryStoragePath reads one canonical media-library storage path,
// `media/<uuid>/<variant>/image.<ext>`, without the /storage/ prefix. Encoded or
// ambiguous paths are rejected. The storage route, the library itself, the card
// picture rule and the missing-media check all read library paths with it.
func ParseMediaLibraryStoragePath(raw string) (id, variant, filename string, ok bool) {
	parts := strings.Split(raw, "/")
	if len(parts) != 4 || parts[0] != "media" {
		return
	}
	parsed, err := uuid.Parse(parts[1])
	if err != nil || parsed.String() != parts[1] {
		return
	}
	switch parts[2] {
	case "original", "300", "1000", "2160":
	default:
		return
	}
	ext := strings.ToLower(path.Ext(parts[3]))
	if parts[3] != "image"+ext || !IsMediaLibraryImageExtension(ext) {
		return
	}
	return parts[1], parts[2], parts[3], true
}

// IsMediaLibraryImageExtension names the picture formats the media library stores.
func IsMediaLibraryImageExtension(ext string) bool {
	switch ext {
	case ".png", ".jpg", ".jpeg", ".webp", ".gif":
		return true
	}
	return false
}

// StoredFileStatus is what one look at a storage-root-relative path found.
type StoredFileStatus int

const (
	// StoredFileUnknown: the path could not be checked — the storage root is not
	// there or not a folder (for example a disk that is not mounted), or the look
	// failed for a reason other than absence, such as a permission or disk error.
	StoredFileUnknown StoredFileStatus = iota
	// StoredFileExists: a regular file is there, as storage delivery serves it.
	StoredFileExists
	// StoredFileMissing: the root is readable and nothing storage delivery would
	// serve is at the path.
	StoredFileMissing
)

// StoredFileState returns a check for one storage-root-relative path that tells a
// regular file, as storage delivery serves it, from one that is certainly gone and from
// one that could not be checked. It resolves a symlinked storage root once (native and
// container installations may reach storage through one). A writer that would give up
// the only reference to a picture must treat Unknown as present, so an unreadable or
// unmounted disk never turns a picture into a missing one.
func StoredFileState(storageRoot string) func(relativePath string) StoredFileStatus {
	resolvedRoot := storageRoot
	if resolved, err := filepath.EvalSymlinks(storageRoot); err == nil {
		resolvedRoot = resolved
	}
	return func(relativePath string) StoredFileStatus {
		if rootInfo, err := os.Stat(resolvedRoot); err != nil || !rootInfo.IsDir() {
			return StoredFileUnknown
		}
		info, err := os.Stat(filepath.Join(resolvedRoot, filepath.FromSlash(relativePath)))
		switch {
		case err == nil && info.Mode().IsRegular():
			return StoredFileExists
		case err == nil, errors.Is(err, fs.ErrNotExist), errors.Is(err, syscall.ENOTDIR):
			return StoredFileMissing
		default:
			return StoredFileUnknown
		}
	}
}

// StoredPictureState answers for one picture stored in several size folders
// (VariantRelativePaths): Exists when any of them holds it, because storage delivery
// falls back between sizes; Missing only when every look certainly found nothing;
// Unknown otherwise.
func StoredPictureState(relativePaths []string, fileState func(relativePath string) StoredFileStatus) StoredFileStatus {
	state := StoredFileMissing
	for _, relativePath := range relativePaths {
		switch fileState(relativePath) {
		case StoredFileExists:
			return StoredFileExists
		case StoredFileUnknown:
			state = StoredFileUnknown
		}
	}
	return state
}
