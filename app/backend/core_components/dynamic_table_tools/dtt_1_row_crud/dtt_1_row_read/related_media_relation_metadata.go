// related_media_relation_metadata.go
// Classifies a related table by its file-upload metadata for the related-rows response.
// Bridges row-read responses and the relation reading of dtt_card_picture, which owns the
// parsing of system_foreign_key_relations_1_m file_upload specs.
// Exists so the response's relation kind and the card picture's gallery are decided from
// the same parsed metadata.
package dtt_1_row_read

import "easelect/backend/core_components/dynamic_table_tools/dtt_card_picture"

func resolveRelatedTableKind(status dtt_card_picture.RelationStatus) string {
	if status.UploadConfig.UsesSharedAsset() {
		return relatedTableKindSharedAsset
	}
	if status.UploadConfig.SupportsImage() {
		return relatedTableKindImageAsset
	}
	return relatedTableKindRows
}
