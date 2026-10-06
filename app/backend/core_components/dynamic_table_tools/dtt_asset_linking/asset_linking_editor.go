// asset_linking_editor.go
// Updates asset-linking file_upload metadata for one parent relation.
// Bridges admin intent and the target_insert_specs JSON stored in FK metadata rows.
// Exists to keep relation-identity upload-config persistence in one helper.
package dtt_asset_linking

import (
	"easelect/backend/core_components/dbutils"
	"fmt"
)

// SaveFileUploadConfigByRelationID persists one file_upload config back to one relation row.
func SaveFileUploadConfigByRelationID(q dbutils.Querier, relationID int, uploadConfig FileUploadConfig) error {
	specsJSON, err := BuildTargetInsertSpecsJSON(uploadConfig)
	if err != nil {
		return err
	}

	result, err := q.Exec(
		`UPDATE system_foreign_key_relations_1_m
		 SET target_insert_specs = $1
		 WHERE id = $2`,
		specsJSON, relationID,
	)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count != 1 {
		return fmt.Errorf("asset relation %d no longer exists", relationID)
	}
	return nil
}
