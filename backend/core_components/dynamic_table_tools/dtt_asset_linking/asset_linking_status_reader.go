// asset_linking_status_reader.go
// Creates future-facing status snapshots for asset-linking capabilities.
// Bridges raw table names and capability states into a stable asset_linking response shape.
// Exists to keep capability status payloads consistent across image and attachment profiles.
package dtt_asset_linking

// NewCapabilitySnapshot returns a stable status payload for one parent table.
func NewCapabilitySnapshot(
	parentTable string,
	childTable string,
	storageDriver string,
	capabilities map[AssetKind]CapabilityState,
) AssetCapabilitySnapshot {
	clonedCapabilities := make(map[AssetKind]CapabilityState, len(capabilities))
	for kind, state := range capabilities {
		clonedCapabilities[kind] = state
	}

	return AssetCapabilitySnapshot{
		ParentTable:   parentTable,
		ChildTable:    childTable,
		StorageDriver: storageDriver,
		Capabilities:  clonedCapabilities,
	}
}

// ResolveFileUploadProfileKey returns the primary logical asset profile for one relation row.
func ResolveFileUploadProfileKey(status FileUploadRelationStatus) string {
	profileKeys := ResolveProfileKeys(status.UploadConfig, status.ChildTable)
	if len(profileKeys) == 0 {
		return ""
	}
	return profileKeys[0]
}

// FilterFileUploadRelationStatusesByProfile keeps only relation rows for one logical asset profile.
func FilterFileUploadRelationStatusesByProfile(statuses []FileUploadRelationStatus, profileKey string) []FileUploadRelationStatus {
	filtered := make([]FileUploadRelationStatus, 0, len(statuses))
	for _, status := range statuses {
		if statusSupportsProfile(status, profileKey) {
			filtered = append(filtered, status)
		}
	}
	return filtered
}

// ResolveProfileUploadConfigFromStatus extracts the requested logical profile from one relation row.
func ResolveProfileUploadConfigFromStatus(status FileUploadRelationStatus, profileKey string) (FileUploadProfileConfig, bool) {
	return ResolveProfileUploadConfig(status.UploadConfig, status.ChildTable, profileKey)
}

func statusSupportsProfile(status FileUploadRelationStatus, profileKey string) bool {
	for _, resolvedProfileKey := range ResolveProfileKeys(status.UploadConfig, status.ChildTable) {
		if resolvedProfileKey == profileKey {
			return true
		}
	}
	return false
}

// ResolveRelationKindForProfile returns the read-side relation hint the frontend
// should prefer before falling back to child-table suffix heuristics.
func ResolveRelationKindForProfile(status FileUploadRelationStatus, profileKey string) string {
	if UsesSharedAssetRelation(status.UploadConfig) {
		return RelationKindSharedAsset
	}
	if profileKey == AssetProfileImage && statusSupportsProfile(status, AssetProfileImage) {
		return RelationKindImageAsset
	}
	return RelationKindRelatedRows
}

func hasAssetKind(config FileUploadConfig, target AssetKind) bool {
	for _, kind := range config.AssetKinds {
		if kind == target {
			return true
		}
	}
	return false
}

func hasAnyAttachmentAssetKind(config FileUploadConfig) bool {
	for _, kind := range config.AssetKinds {
		if kind == AssetKindPDF || kind == AssetKindDocument || kind == AssetKindArchive {
			return true
		}
	}
	return false
}

func hasCacheTargetColumn(config FileUploadConfig, columnName string) bool {
	for _, target := range config.CacheTargets {
		if target.Column == columnName {
			return true
		}
	}
	return false
}
