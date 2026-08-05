// asset_linking_builder.go
// Builds and normalizes shared asset-linking profile config for FK metadata rows.
// Bridges single-profile legacy file_upload specs and the new multi-capability shared relation model.
// Exists to keep image + attachment profile merging in one place before more asset kinds arrive.
package dtt_asset_linking

import "sort"

const SharedAssetProfileKey = "asset_linking"

var assetProfileOrder = []string{
	AssetProfileImage,
	AssetProfileAttachment,
}

// NormalizeFileUploadConfig fills nil slices/maps so shared asset helpers can reason safely.
func NormalizeFileUploadConfig(config FileUploadConfig) FileUploadConfig {
	if config.AssetKinds == nil {
		config.AssetKinds = []AssetKind{}
	}
	if config.AllowedFileTypes == nil {
		config.AllowedFileTypes = []string{}
	}
	if config.CacheTargets == nil {
		config.CacheTargets = []CacheTarget{}
	}
	if config.Profiles == nil {
		config.Profiles = map[string]FileUploadProfileConfig{}
	} else {
		normalizedProfiles := make(map[string]FileUploadProfileConfig, len(config.Profiles))
		for profileKey, profileConfig := range config.Profiles {
			normalizedProfiles[profileKey] = normalizeProfileUploadConfig(profileConfig)
		}
		config.Profiles = normalizedProfiles
	}
	if config.FilenameColumn == "" {
		config.FilenameColumn = "filename"
	}
	return config
}

// ResolveProfileUploadConfig returns one logical profile from either shared or legacy config.
func ResolveProfileUploadConfig(config FileUploadConfig, childTable string, profileKey string) (FileUploadProfileConfig, bool) {
	config = NormalizeFileUploadConfig(config)

	if profileConfig, ok := config.Profiles[profileKey]; ok {
		return normalizeProfileUploadConfig(profileConfig), true
	}

	if !supportsProfileKey(config, childTable, profileKey) {
		return FileUploadProfileConfig{}, false
	}

	return normalizeProfileUploadConfig(FileUploadProfileConfig{
		Enabled:          config.Enabled,
		AssetKinds:       append([]AssetKind(nil), config.AssetKinds...),
		AllowedFileTypes: append([]string(nil), config.AllowedFileTypes...),
		MaxFileSizeMB:    config.MaxFileSizeMB,
		TargetDirectory:  config.TargetDirectory,
		CacheTargets:     append([]CacheTarget(nil), config.CacheTargets...),
	}), true
}

// ResolveEffectiveUploadConfigForProfile flattens one logical profile back to upload-time settings.
func ResolveEffectiveUploadConfigForProfile(config FileUploadConfig, childTable string, profileKey string) (FileUploadConfig, bool) {
	profileConfig, ok := ResolveProfileUploadConfig(config, childTable, profileKey)
	if !ok {
		return FileUploadConfig{}, false
	}

	return NormalizeFileUploadConfig(FileUploadConfig{
		Enabled:          profileConfig.Enabled,
		ProfileKey:       profileKey,
		AssetKinds:       append([]AssetKind(nil), profileConfig.AssetKinds...),
		AllowedFileTypes: append([]string(nil), profileConfig.AllowedFileTypes...),
		FilenameColumn:   NormalizeFileUploadConfig(config).FilenameColumn,
		MaxFileSizeMB:    profileConfig.MaxFileSizeMB,
		TargetDirectory:  profileConfig.TargetDirectory,
		CacheTargets:     append([]CacheTarget(nil), profileConfig.CacheTargets...),
		Profiles: map[string]FileUploadProfileConfig{
			profileKey: profileConfig,
		},
	}), true
}

// ResolveProfileKeys returns every logical profile carried by one relation row.
func ResolveProfileKeys(config FileUploadConfig, childTable string) []string {
	config = NormalizeFileUploadConfig(config)

	if len(config.Profiles) > 0 {
		keys := make([]string, 0, len(config.Profiles))
		for profileKey := range config.Profiles {
			keys = append(keys, profileKey)
		}
		sortProfileKeys(keys)
		return keys
	}

	keys := make([]string, 0, 2)
	if supportsProfileKey(config, childTable, AssetProfileImage) {
		keys = append(keys, AssetProfileImage)
	}
	if supportsProfileKey(config, childTable, AssetProfileAttachment) {
		keys = append(keys, AssetProfileAttachment)
	}
	sortProfileKeys(keys)
	return keys
}

// SetProfileUploadConfig stores or updates one capability inside a shared asset relation.
func SetProfileUploadConfig(config FileUploadConfig, profileKey string, profileConfig FileUploadProfileConfig) FileUploadConfig {
	config = NormalizeFileUploadConfig(config)
	config.Profiles[profileKey] = normalizeProfileUploadConfig(profileConfig)
	syncLegacyFieldsFromProfiles(&config)
	return config
}

// RemoveProfileUploadConfig removes one capability and re-derives the aggregate fields.
func RemoveProfileUploadConfig(config FileUploadConfig, profileKey string) (FileUploadConfig, bool) {
	config = NormalizeFileUploadConfig(config)
	delete(config.Profiles, profileKey)
	if len(config.Profiles) == 0 {
		return FileUploadConfig{}, false
	}
	syncLegacyFieldsFromProfiles(&config)
	return config, true
}

// ResolveProfileKeyForAssetKind maps a stored asset_kind value to the logical capability key.
func ResolveProfileKeyForAssetKind(assetKind string) string {
	switch AssetKind(assetKind) {
	case AssetKindImage:
		return AssetProfileImage
	case AssetKindPDF, AssetKindDocument, AssetKindArchive:
		return AssetProfileAttachment
	default:
		return ""
	}
}

// UsesSharedAssetRelation reports whether one file_upload config is using the
// canonical shared profile-map model instead of a legacy single-purpose shape.
func UsesSharedAssetRelation(config FileUploadConfig) bool {
	config = NormalizeFileUploadConfig(config)
	return len(config.Profiles) > 0 || config.ProfileKey == SharedAssetProfileKey
}

func normalizeProfileUploadConfig(profileConfig FileUploadProfileConfig) FileUploadProfileConfig {
	if profileConfig.AssetKinds == nil {
		profileConfig.AssetKinds = []AssetKind{}
	}
	if profileConfig.AllowedFileTypes == nil {
		profileConfig.AllowedFileTypes = []string{}
	}
	if profileConfig.CacheTargets == nil {
		profileConfig.CacheTargets = []CacheTarget{}
	}
	return profileConfig
}

func supportsProfileKey(config FileUploadConfig, childTable string, profileKey string) bool {
	if config.ProfileKey == profileKey {
		return true
	}

	switch profileKey {
	case AssetProfileImage:
		if hasAssetKind(config, AssetKindImage) ||
			config.TargetDirectory == "media" ||
			hasCacheTargetColumn(config, "cached_image") {
			return true
		}
		return false
	case AssetProfileAttachment:
		return hasAnyAttachmentAssetKind(config) ||
			config.TargetDirectory == "attachments"
	default:
		return false
	}
}

func syncLegacyFieldsFromProfiles(config *FileUploadConfig) {
	if config == nil {
		return
	}

	normalizedProfiles := make(map[string]FileUploadProfileConfig, len(config.Profiles))
	profileKeys := make([]string, 0, len(config.Profiles))
	for profileKey, profileConfig := range config.Profiles {
		normalizedProfiles[profileKey] = normalizeProfileUploadConfig(profileConfig)
		profileKeys = append(profileKeys, profileKey)
	}
	config.Profiles = normalizedProfiles
	sortProfileKeys(profileKeys)

	config.Enabled = false
	config.AssetKinds = []AssetKind{}
	config.AllowedFileTypes = []string{}
	config.CacheTargets = []CacheTarget{}
	config.MaxFileSizeMB = 0
	config.TargetDirectory = ""

	seenKinds := make(map[AssetKind]bool)
	seenAllowedTypes := make(map[string]bool)
	seenCacheTargets := make(map[string]bool)
	seenDirectories := make(map[string]bool)

	for _, profileKey := range profileKeys {
		profileConfig := config.Profiles[profileKey]
		if profileConfig.Enabled {
			config.Enabled = true
		}
		if profileConfig.MaxFileSizeMB > config.MaxFileSizeMB {
			config.MaxFileSizeMB = profileConfig.MaxFileSizeMB
		}
		if profileConfig.TargetDirectory != "" {
			seenDirectories[profileConfig.TargetDirectory] = true
			if config.TargetDirectory == "" {
				config.TargetDirectory = profileConfig.TargetDirectory
			}
		}
		for _, assetKind := range profileConfig.AssetKinds {
			if seenKinds[assetKind] {
				continue
			}
			seenKinds[assetKind] = true
			config.AssetKinds = append(config.AssetKinds, assetKind)
		}
		for _, fileType := range profileConfig.AllowedFileTypes {
			if seenAllowedTypes[fileType] {
				continue
			}
			seenAllowedTypes[fileType] = true
			config.AllowedFileTypes = append(config.AllowedFileTypes, fileType)
		}
		for _, cacheTarget := range profileConfig.CacheTargets {
			cacheKey := cacheTarget.Table + "." + cacheTarget.Column
			if seenCacheTargets[cacheKey] {
				continue
			}
			seenCacheTargets[cacheKey] = true
			config.CacheTargets = append(config.CacheTargets, cacheTarget)
		}
	}

	if len(seenDirectories) > 1 {
		config.TargetDirectory = "assets"
	}

	if len(profileKeys) == 1 {
		config.ProfileKey = profileKeys[0]
	} else {
		config.ProfileKey = SharedAssetProfileKey
	}
}

func sortProfileKeys(profileKeys []string) {
	sort.SliceStable(profileKeys, func(i, j int) bool {
		leftIdx := indexOfProfileKey(profileKeys[i])
		rightIdx := indexOfProfileKey(profileKeys[j])
		if leftIdx == rightIdx {
			return profileKeys[i] < profileKeys[j]
		}
		return leftIdx < rightIdx
	})
}

func indexOfProfileKey(profileKey string) int {
	for idx, candidate := range assetProfileOrder {
		if candidate == profileKey {
			return idx
		}
	}
	return len(assetProfileOrder) + 1
}

func hasAssetChildTableSuffix(childTable string, suffix string) bool {
	return len(childTable) >= len(suffix) && childTable[len(childTable)-len(suffix):] == suffix
}

func hasExplicitFileUploadSignals(config FileUploadConfig) bool {
	return config.ProfileKey != "" ||
		config.TargetDirectory != "" ||
		len(config.AssetKinds) > 0 ||
		len(config.CacheTargets) > 0 ||
		len(config.Profiles) > 0
}
