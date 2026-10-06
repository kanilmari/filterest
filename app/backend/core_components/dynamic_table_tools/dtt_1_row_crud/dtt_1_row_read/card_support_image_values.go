// card_support_image_values.go
// Normalizes card image values and companion metadata for gallery enrichment.
// Shared by the authorized gallery reader and the existing card-support tests.
// Keeps value conversion separate from permission and row-visibility decisions.
package dtt_1_row_read

import (
	"easelect/backend/core_components/dynamic_table_tools/dtt_card_picture"
	"fmt"
	"strconv"
	"strings"
)

func resolveCardImageLookupKeys(supportColumns []string) []string {
	merged := make([]string, 0, len(dtt_card_picture.CardPictureFields)+len(supportColumns))
	seen := make(map[string]bool, len(dtt_card_picture.CardPictureFields)+len(supportColumns))

	for _, columnName := range dtt_card_picture.CardPictureFields {
		if columnName == "" || seen[columnName] {
			continue
		}
		seen[columnName] = true
		merged = append(merged, columnName)
	}

	for _, columnName := range supportColumns {
		if columnName == "" || seen[columnName] {
			continue
		}
		seen[columnName] = true
		merged = append(merged, columnName)
	}

	return merged
}

func resolveExistingCardImageValue(row map[string]interface{}, imageKeys []string) string {
	if row == nil {
		return ""
	}

	for _, key := range imageKeys {
		value := normalizeCardSupportValue(row[key])
		if value != "" {
			return value
		}
	}

	return ""
}

func normalizeCardSupportValue(rawValue interface{}) string {
	switch typedValue := rawValue.(type) {
	case nil:
		return ""
	case string:
		return strings.TrimSpace(typedValue)
	case []byte:
		return strings.TrimSpace(string(typedValue))
	default:
		return strings.TrimSpace(fmt.Sprint(rawValue))
	}
}

func coerceCanonicalAssetTypeID(rawValue interface{}) int64 {
	switch typedValue := rawValue.(type) {
	case nil:
		return 0
	case int:
		return int64(typedValue)
	case int32:
		return int64(typedValue)
	case int64:
		return typedValue
	case float64:
		return int64(typedValue)
	case string:
		parsed, err := strconv.ParseInt(strings.TrimSpace(typedValue), 10, 64)
		if err == nil {
			return parsed
		}
	case []byte:
		parsed, err := strconv.ParseInt(strings.TrimSpace(string(typedValue)), 10, 64)
		if err == nil {
			return parsed
		}
	}
	return 0
}

func applyLegacyChildImageValues(rows []map[string]interface{}, imageByID map[string]canonicalAssetImageValue, parentTableUID string) {
	if len(rows) == 0 || len(imageByID) == 0 {
		return
	}

	imageKeys := resolveCardImageLookupKeys(nil)
	for _, row := range rows {
		rowID, ok := coerceCardSupportRowID(row["id"])
		if !ok {
			continue
		}

		imageValue, exists := imageByID[strconv.FormatInt(rowID, 10)]
		if !exists || imageValue.filename == "" {
			continue
		}

		existingImage := resolveExistingCardImageValue(row, imageKeys)
		if existingImage != "" && !cardImageFilenameMatches(existingImage, imageValue.filename, parentTableUID, rowID) {
			continue
		}
		if existingImage == "" {
			row["cached_image"] = imageValue.filename
		}
		row["cached_image_type_id"] = imageValue.typeID
		if imageValue.metadataJSON != "" {
			row["cached_image_metadata_json"] = imageValue.metadataJSON
		}
		if imageValue.title != "" {
			row["cached_image_title"] = imageValue.title
		}
		if imageValue.originalName != "" {
			row["cached_image_original_name"] = imageValue.originalName
		}
	}
}

// Use K121's strict file placement, also used by ClassifyCardPicture. A basename
// cannot establish ownership: addresses, library paths and other rows stay separate.
func ownGalleryPictureIdentity(value, parentTableUID string, parentRowID int64) (string, bool) {
	tableUID, rowID, filename, ok := dtt_card_picture.ResolveStoredPictureLocation(value, parentTableUID, parentRowID)
	if !ok || tableUID != parentTableUID || rowID != parentRowID {
		return "", false
	}
	return fmt.Sprintf("%s/%d/%s", tableUID, rowID, filename), true
}

func cardImageFilenameMatches(existingImage, canonicalFilename, parentTableUID string, parentRowID int64) bool {
	existing, own := ownGalleryPictureIdentity(existingImage, parentTableUID, parentRowID)
	canonical, galleryOwn := ownGalleryPictureIdentity(canonicalFilename, parentTableUID, parentRowID)
	return own && galleryOwn && existing == canonical
}

func collectCardSupportRowIDs(rows []map[string]interface{}) []int64 {
	collected := make([]int64, 0, len(rows))
	seen := make(map[int64]bool, len(rows))

	for _, row := range rows {
		rowID, ok := coerceCardSupportRowID(row["id"])
		if !ok || seen[rowID] {
			continue
		}
		seen[rowID] = true
		collected = append(collected, rowID)
	}

	return collected
}

func coerceCardSupportRowID(rawValue interface{}) (int64, bool) {
	switch typedValue := rawValue.(type) {
	case int:
		return int64(typedValue), true
	case int32:
		return int64(typedValue), true
	case int64:
		return typedValue, true
	case float64:
		return int64(typedValue), true
	case string:
		parsed, err := strconv.ParseInt(strings.TrimSpace(typedValue), 10, 64)
		return parsed, err == nil
	case []byte:
		parsed, err := strconv.ParseInt(strings.TrimSpace(string(typedValue)), 10, 64)
		return parsed, err == nil
	default:
		return 0, false
	}
}

// clearGalleryCachedImage removes only a cache already proven gallery-derived.
func clearGalleryCachedImage(row map[string]interface{}) {
	for key := range row {
		if key == "cached_image" || strings.HasPrefix(key, "cached_image_") {
			delete(row, key)
		}
	}
}

// A cached picture can be any visible row of this parent's own gallery.
func filterGalleryCachedImages(rows []map[string]interface{}, matching map[string][]string, images map[string]canonicalAssetImageValue, parentTableUID string) {
	for _, row := range rows {
		cached := normalizeCardSupportValue(row["cached_image"])
		id, ok := coerceCardSupportRowID(row["id"])
		if !ok {
			continue
		}
		key := strconv.FormatInt(id, 10)
		derived := false
		for _, filename := range matching[key] {
			derived = derived || cardImageFilenameMatches(cached, filename, parentTableUID, id)
		}
		if !derived {
			continue
		}
		visible := false
		for _, filename := range images[key].visibleFilenames {
			visible = visible || cardImageFilenameMatches(cached, filename, parentTableUID, id)
		}
		if !visible {
			clearGalleryCachedImage(row)
		}
	}
}
