// asset_linking_editor.go
// Updates asset-linking file_upload metadata for one parent relation.
// Bridges admin intent and the target_insert_specs JSON stored in FK metadata rows.
// Exists to keep relation-identity upload-config persistence in one helper.
package dtt_asset_linking

import "easelect/backend/core_components/dbutils"

// SaveFileUploadConfigByRelationID persists one file_upload config back to one relation row.
func SaveFileUploadConfigByRelationID(q dbutils.Querier, relationID int, uploadConfig FileUploadConfig) error {
	specsJSON, err := BuildTargetInsertSpecsJSON(uploadConfig)
	if err != nil {
		return err
	}

	_, err = q.Exec(
		`UPDATE system_foreign_key_relations_1_m
		 SET target_insert_specs = $1
		 WHERE id = $2 AND target_insert_specs->'file_upload' IS NOT NULL`,
		specsJSON, relationID,
	)
	return err
}
