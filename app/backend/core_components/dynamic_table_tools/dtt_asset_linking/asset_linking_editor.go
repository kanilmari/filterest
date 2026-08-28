// asset_linking_editor.go
// Updates asset-linking file_upload metadata for one parent relation.
// Bridges admin intent and the target_insert_specs JSON stored in FK metadata rows.
// Exists to centralize enabled toggles and upload-config persistence outside the legacy image-linking handlers.
package dtt_asset_linking

import (
	"fmt"

	"easelect/backend/core_components/dbutils"
)

// SetFileUploadEnabled flips the file_upload.enabled flag for one parent table.
func SetFileUploadEnabled(q dbutils.Querier, parentTableUID int, enabled bool) (int64, error) {
	enabledJSON := "false"
	if enabled {
		enabledJSON = "true"
	}

	query := fmt.Sprintf(
		`UPDATE system_foreign_key_relations_1_m
		 SET target_insert_specs = jsonb_set(target_insert_specs, '{file_upload,enabled}', '%s')
		 WHERE target_table_uid = $1
		   AND target_insert_specs->'file_upload' IS NOT NULL`,
		enabledJSON,
	)

	result, err := q.Exec(query, parentTableUID)
	if err != nil {
		return 0, err
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return 0, err
	}

	return rowsAffected, nil
}

// SetFileUploadEnabledByRelationID flips the file_upload.enabled flag for one specific relation row.
func SetFileUploadEnabledByRelationID(q dbutils.Querier, relationID int, enabled bool) error {
	enabledJSON := "false"
	if enabled {
		enabledJSON = "true"
	}

	query := fmt.Sprintf(
		`UPDATE system_foreign_key_relations_1_m
		 SET target_insert_specs = jsonb_set(target_insert_specs, '{file_upload,enabled}', '%s')
		 WHERE id = $1
		   AND target_insert_specs->'file_upload' IS NOT NULL`,
		enabledJSON,
	)

	_, err := q.Exec(query, relationID)
	return err
}

// LoadFileUploadConfig fetches and parses file_upload config for one parent table.
func LoadFileUploadConfig(q dbutils.Querier, parentTableUID int) (FileUploadConfig, error) {
	var specsJSON []byte
	err := q.QueryRow(
		`SELECT target_insert_specs FROM system_foreign_key_relations_1_m
		 WHERE target_table_uid = $1 AND target_insert_specs->'file_upload' IS NOT NULL`,
		parentTableUID,
	).Scan(&specsJSON)
	if err != nil {
		return FileUploadConfig{}, err
	}

	return ParseFileUploadConfig(specsJSON)
}

// SaveFileUploadConfig persists one file_upload config for the parent relation row.
func SaveFileUploadConfig(q dbutils.Querier, parentTableUID int, uploadConfig FileUploadConfig) error {
	specsJSON, err := BuildTargetInsertSpecsJSON(uploadConfig)
	if err != nil {
		return err
	}

	_, err = q.Exec(
		`UPDATE system_foreign_key_relations_1_m
		 SET target_insert_specs = $1
		 WHERE target_table_uid = $2 AND target_insert_specs->'file_upload' IS NOT NULL`,
		specsJSON, parentTableUID,
	)
	return err
}

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
