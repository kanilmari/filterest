// variants.go
// Names the on-disk 300/1000/2160/original folders and the order used when a requested file is missing.
// Bridges catalog/list/background URL selection with storage delivery.
// Exists so a missing display derivative prefers another sized file instead of jumping to original.
package media_utils

import (
	"path"
	"strings"
)

const OriginalVariant = "original"

// SizedVariants is the display-sized folders that ordinary page slots should request.
var SizedVariants = []string{"300", "1000", "2160"}

// IsKnownVariant reports whether name is one of the stored media folders.
func IsKnownVariant(name string) bool {
	switch name {
	case "300", "1000", "2160", OriginalVariant:
		return true
	default:
		return false
	}
}

// FallbackOrder returns the files to try when serving a requested variant.
// Sized requests try the exact folder, then the next-best smaller size, then a
// larger sibling, and original only last. An original request stays original.
// An unknown name still prefers sized folders over original.
func FallbackOrder(requested string) []string {
	switch requested {
	case "300":
		return []string{"300", "1000", "2160", OriginalVariant}
	case "1000":
		return []string{"1000", "300", "2160", OriginalVariant}
	case "2160":
		return []string{"2160", "1000", "300", OriginalVariant}
	case OriginalVariant:
		return []string{OriginalVariant}
	default:
		return []string{"1000", "300", "2160", OriginalVariant}
	}
}

// VariantFromRelativePath reads the variant folder out of a storage-relative path.
func VariantFromRelativePath(rel string) (string, bool) {
	parts, ok := splitStorageRelativePath(rel)
	if !ok {
		return "", false
	}
	index, ok := variantIndex(parts)
	if !ok {
		return "", false
	}
	return parts[index], true
}

// ReplaceVariantFolder swaps the recognized variant directory in a storage-relative path.
func ReplaceVariantFolder(rel, variant string) (string, bool) {
	if !IsKnownVariant(variant) {
		return "", false
	}
	parts, ok := splitStorageRelativePath(rel)
	if !ok {
		return "", false
	}
	index, ok := variantIndex(parts)
	if !ok {
		return "", false
	}
	parts[index] = variant
	return strings.Join(parts, "/"), true
}

func splitStorageRelativePath(rel string) ([]string, bool) {
	normalized := strings.TrimPrefix(path.Clean("/"+strings.ReplaceAll(rel, `\`, "/")), "/")
	if normalized == "" || normalized == "." {
		return nil, false
	}
	parts := strings.Split(normalized, "/")
	if len(parts) < 4 {
		return nil, false
	}
	return parts, true
}

func variantIndex(parts []string) (int, bool) {
	switch {
	case len(parts) == 4 && parts[0] == "media" && IsKnownVariant(parts[2]):
		return 2, true
	case len(parts) == 5 && parts[1] == "dataset_media" && IsKnownVariant(parts[3]):
		return 3, true
	case len(parts) == 4 && parts[0] != "media" && parts[1] != "dataset_media" && IsKnownVariant(parts[2]):
		return 2, true
	default:
		return 0, false
	}
}
