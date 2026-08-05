// asset_linking_specs_builder.go
// Builds generic file-upload specs for asset-linking child relations.
// Bridges the future asset_linking module and system_foreign_key_relations_1_m target_insert_specs JSON.
// Exists to keep spec-shape decisions in one place instead of scattering them across handlers.
package dtt_asset_linking

// BuildFileUploadConfig creates the shared upload config used by asset child tables.
func BuildFileUploadConfig(
	parentTable string,
	maxFileSizeMB int,
	targetDirectory string,
	filenameColumn string,
	allowedFileTypes []string,
	cacheColumns []string,
) FileUploadConfig {
	cacheTargets := make([]CacheTarget, 0, len(cacheColumns))
	for _, columnName := range cacheColumns {
		cacheTargets = append(cacheTargets, CacheTarget{
			Table:  parentTable,
			Column: columnName,
		})
	}

	return FileUploadConfig{
		Enabled:          true,
		AllowedFileTypes: append([]string(nil), allowedFileTypes...),
		FilenameColumn:   filenameColumn,
		MaxFileSizeMB:    maxFileSizeMB,
		TargetDirectory:  targetDirectory,
		CacheTargets:     cacheTargets,
		Profiles:         map[string]FileUploadProfileConfig{},
	}
}

// BuildImageProfileConfig keeps image-only cache and media defaults reusable inside shared asset relations.
func BuildImageProfileConfig(parentTable string, maxFileSizeMB int, allowedFileTypes []string) FileUploadProfileConfig {
	return normalizeProfileUploadConfig(FileUploadProfileConfig{
		Enabled:          true,
		AssetKinds:       []AssetKind{AssetKindImage},
		AllowedFileTypes: append([]string(nil), allowedFileTypes...),
		MaxFileSizeMB:    maxFileSizeMB,
		TargetDirectory:  "media",
		CacheTargets: []CacheTarget{
			{
				Table:  parentTable,
				Column: "cached_image",
			},
		},
	})
}

// BuildImageFileUploadConfig keeps the current cached_image convention explicit in one helper.
func BuildImageFileUploadConfig(parentTable string, maxFileSizeMB int, allowedFileTypes []string) FileUploadConfig {
	config := BuildFileUploadConfig(
		parentTable,
		maxFileSizeMB,
		"media",
		"filename",
		allowedFileTypes,
		[]string{"cached_image"},
	)
	return SetProfileUploadConfig(config, AssetProfileImage, BuildImageProfileConfig(parentTable, maxFileSizeMB, allowedFileTypes))
}

// BuildAttachmentProfileConfig prepares attachment-specific settings inside the shared asset relation.
func BuildAttachmentProfileConfig(parentTable string, maxFileSizeMB int, allowedFileTypes []string) FileUploadProfileConfig {
	return normalizeProfileUploadConfig(FileUploadProfileConfig{
		Enabled:          true,
		AssetKinds:       []AssetKind{AssetKindPDF, AssetKindDocument, AssetKindArchive},
		AllowedFileTypes: append([]string(nil), allowedFileTypes...),
		MaxFileSizeMB:    maxFileSizeMB,
		TargetDirectory:  "attachments",
		CacheTargets:     []CacheTarget{},
	})
}

// BuildAttachmentFileUploadConfig prepares a non-image attachment config on the shared asset-linking path.
func BuildAttachmentFileUploadConfig(parentTable string, maxFileSizeMB int, allowedFileTypes []string) FileUploadConfig {
	config := BuildFileUploadConfig(
		parentTable,
		maxFileSizeMB,
		"attachments",
		"filename",
		allowedFileTypes,
		nil,
	)
	return SetProfileUploadConfig(config, AssetProfileAttachment, BuildAttachmentProfileConfig(parentTable, maxFileSizeMB, allowedFileTypes))
}

// BuildTargetInsertSpecs converts typed upload config into the JSON shape used in FK metadata.
func BuildTargetInsertSpecs(uploadConfig FileUploadConfig) map[string]interface{} {
	normalizedConfig := NormalizeFileUploadConfig(uploadConfig)
	cacheTargets := make([]map[string]string, 0, len(uploadConfig.CacheTargets))
	for _, target := range normalizedConfig.CacheTargets {
		cacheTargets = append(cacheTargets, map[string]string{
			"table":  target.Table,
			"column": target.Column,
		})
	}

	return map[string]interface{}{
		"file_upload": map[string]interface{}{
			"enabled":            normalizedConfig.Enabled,
			"profile_key":        normalizedConfig.ProfileKey,
			"asset_kinds":        append([]AssetKind(nil), normalizedConfig.AssetKinds...),
			"allowed_file_types": append([]string(nil), normalizedConfig.AllowedFileTypes...),
			"filename_column":    normalizedConfig.FilenameColumn,
			"max_file_size_mb":   normalizedConfig.MaxFileSizeMB,
			"target_directory":   normalizedConfig.TargetDirectory,
			"cache_targets":      cacheTargets,
			"profiles":           normalizedConfig.Profiles,
		},
	}
}

// BuildImageTargetInsertSpecs preserves the current image-linking API payload shape during migration.
func BuildImageTargetInsertSpecs(parentTable string, maxFileSizeMB int, allowedFileTypes []string) map[string]interface{} {
	return BuildTargetInsertSpecs(BuildImageFileUploadConfig(parentTable, maxFileSizeMB, allowedFileTypes))
}

// BuildAttachmentTargetInsertSpecs keeps the first attachment profile on the same shared upload-spec path.
func BuildAttachmentTargetInsertSpecs(parentTable string, maxFileSizeMB int, allowedFileTypes []string) map[string]interface{} {
	return BuildTargetInsertSpecs(BuildAttachmentFileUploadConfig(parentTable, maxFileSizeMB, allowedFileTypes))
}
