// related_media_relation_metadata.go
// Reads related media upload metadata from one-to-many relation specs.
// Bridges row-read enrichment code and system_foreign_key_relations_1_m file upload config.
// Exists so row responses can expose media relation status without duplicating relation parsing.
package dtt_1_row_read

import (
	"encoding/json"
	"fmt"
	"strings"

	"easelect/backend/core_components/dbutils"
)

const sharedAssetProfileKey = "asset_linking"

type relatedMediaRelationStatus struct {
	ParentTable      string
	ChildTable       string
	ForeignKeyColumn string
	UploadConfig     relatedMediaFileUploadConfig
}

type relatedMediaTargetInsertSpecsEnvelope struct {
	FileUpload *relatedMediaFileUploadConfig `json:"file_upload"`
}

type relatedMediaFileUploadConfig struct {
	ProfileKey      string                                   `json:"profile_key,omitempty"`
	AssetKinds      []string                                 `json:"asset_kinds,omitempty"`
	TargetDirectory string                                   `json:"target_directory,omitempty"`
	CacheTargets    []relatedMediaCacheTarget                `json:"cache_targets,omitempty"`
	Profiles        map[string]relatedMediaProfileUploadSpec `json:"profiles,omitempty"`
}

type relatedMediaProfileUploadSpec struct {
	AssetKinds      []string                  `json:"asset_kinds,omitempty"`
	TargetDirectory string                    `json:"target_directory,omitempty"`
	CacheTargets    []relatedMediaCacheTarget `json:"cache_targets,omitempty"`
}

type relatedMediaCacheTarget struct {
	Column string `json:"column,omitempty"`
}

func listRelatedMediaRelationStatuses(
	querier dbutils.Querier,
	parentTable string,
) ([]relatedMediaRelationStatus, error) {
	if querier == nil {
		return nil, nil
	}

	query := `
		SELECT
			src.table_name AS child_table,
			tgt.table_name AS parent_table,
			fk.source_column_name,
			fk.target_insert_specs
		FROM system_foreign_key_relations_1_m fk
		JOIN system_db_tables src ON src.table_uid = fk.source_table_uid
		JOIN system_db_tables tgt ON tgt.table_uid = fk.target_table_uid
		WHERE fk.target_insert_specs->'file_upload' IS NOT NULL`

	args := []interface{}{}
	if strings.TrimSpace(parentTable) != "" {
		query += " AND tgt.table_name = $1"
		args = append(args, parentTable)
	}
	query += " ORDER BY tgt.table_name, src.table_name, fk.id"

	rows, err := querier.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("query related media relation statuses: %w", err)
	}
	defer rows.Close()

	statuses := make([]relatedMediaRelationStatus, 0)
	for rows.Next() {
		var status relatedMediaRelationStatus
		var specsJSON []byte
		if scanErr := rows.Scan(&status.ChildTable, &status.ParentTable, &status.ForeignKeyColumn, &specsJSON); scanErr != nil {
			return nil, fmt.Errorf("scan related media relation status: %w", scanErr)
		}

		uploadConfig, ok := parseRelatedMediaFileUploadConfig(specsJSON)
		if !ok {
			continue
		}
		status.UploadConfig = uploadConfig
		statuses = append(statuses, status)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate related media relation statuses: %w", err)
	}

	return statuses, nil
}

func parseRelatedMediaFileUploadConfig(specsJSON []byte) (relatedMediaFileUploadConfig, bool) {
	var envelope relatedMediaTargetInsertSpecsEnvelope
	if err := json.Unmarshal(specsJSON, &envelope); err != nil || envelope.FileUpload == nil {
		return relatedMediaFileUploadConfig{}, false
	}

	config := *envelope.FileUpload
	if config.AssetKinds == nil {
		config.AssetKinds = []string{}
	}
	if config.CacheTargets == nil {
		config.CacheTargets = []relatedMediaCacheTarget{}
	}
	if config.Profiles == nil {
		config.Profiles = map[string]relatedMediaProfileUploadSpec{}
	} else {
		normalizedProfiles := make(map[string]relatedMediaProfileUploadSpec, len(config.Profiles))
		for profileKey, profileConfig := range config.Profiles {
			if profileConfig.AssetKinds == nil {
				profileConfig.AssetKinds = []string{}
			}
			if profileConfig.CacheTargets == nil {
				profileConfig.CacheTargets = []relatedMediaCacheTarget{}
			}
			normalizedProfiles[profileKey] = profileConfig
		}
		config.Profiles = normalizedProfiles
	}

	return config, true
}

func usesSharedAssetRelation(config relatedMediaFileUploadConfig) bool {
	return len(config.Profiles) > 0 || strings.TrimSpace(config.ProfileKey) == sharedAssetProfileKey
}

func relatedMediaConfigSupportsImage(config relatedMediaFileUploadConfig, childTable string) bool {
	if profileConfig, ok := config.Profiles["image"]; ok {
		if len(profileConfig.AssetKinds) > 0 {
			for _, assetKind := range profileConfig.AssetKinds {
				if strings.EqualFold(strings.TrimSpace(assetKind), "image") {
					return true
				}
			}
		}
		if strings.EqualFold(strings.TrimSpace(profileConfig.TargetDirectory), "media") {
			return true
		}
		for _, cacheTarget := range profileConfig.CacheTargets {
			if strings.EqualFold(strings.TrimSpace(cacheTarget.Column), "cached_image") {
				return true
			}
		}
		return true
	}

	if strings.EqualFold(strings.TrimSpace(config.ProfileKey), "image") {
		return true
	}
	for _, assetKind := range config.AssetKinds {
		if strings.EqualFold(strings.TrimSpace(assetKind), "image") {
			return true
		}
	}
	if strings.EqualFold(strings.TrimSpace(config.TargetDirectory), "media") {
		return true
	}
	for _, cacheTarget := range config.CacheTargets {
		if strings.EqualFold(strings.TrimSpace(cacheTarget.Column), "cached_image") {
			return true
		}
	}
	return false
}

func resolveRelatedTableKind(status relatedMediaRelationStatus) string {
	if usesSharedAssetRelation(status.UploadConfig) {
		return relatedTableKindSharedAsset
	}
	if relatedMediaConfigSupportsImage(status.UploadConfig, status.ChildTable) {
		return relatedTableKindImageAsset
	}
	return relatedTableKindRows
}

func relatedMediaConfigHasExplicitSignals(config relatedMediaFileUploadConfig) bool {
	return strings.TrimSpace(config.ProfileKey) != "" ||
		strings.TrimSpace(config.TargetDirectory) != "" ||
		len(config.AssetKinds) > 0 ||
		len(config.CacheTargets) > 0 ||
		len(config.Profiles) > 0
}
