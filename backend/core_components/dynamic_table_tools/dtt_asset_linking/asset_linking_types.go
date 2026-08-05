// asset_linking_types.go
// Defines shared types for the future asset-linking module.
// Bridges table-level asset capability config, cache targets, and media-profile metadata.
// Exists to give the new asset_linking package one stable vocabulary before live behavior moves here.
package dtt_asset_linking

const StorageDriverLocalFilesystem = "local_filesystem"

const (
	AssetProfileImage      = "image"
	AssetProfileAttachment = "attachment"
)

// AssetKind identifies the media profile handled by an asset row.
type AssetKind string

const (
	AssetKindImage    AssetKind = "image"
	AssetKindVideo    AssetKind = "video"
	AssetKindAudio    AssetKind = "audio"
	AssetKindPDF      AssetKind = "pdf"
	AssetKindDocument AssetKind = "document"
	AssetKindArchive  AssetKind = "archive"
)

// CapabilityState describes whether one asset capability is active for a table.
type CapabilityState string

const (
	CapabilityStateEnabled  CapabilityState = "enabled"
	CapabilityStateDisabled CapabilityState = "disabled"
)

// DefaultImageAllowedTypes preserves the current image-linking defaults during migration.
var DefaultImageAllowedTypes = []string{
	"jpg",
	"jpeg",
	"jfif",
	"bmp",
	"png",
	"webp",
	"avif",
	"gif",
	"ico",
	"tif",
	"tiff",
	"heic",
	"heif",
}

// CacheTarget points from an asset child table back to a parent cache column.
type CacheTarget struct {
	Table  string `json:"table"`
	Column string `json:"column"`
}

// FileUploadProfileConfig describes one capability living inside a shared asset relation.
type FileUploadProfileConfig struct {
	Enabled          bool          `json:"enabled"`
	AssetKinds       []AssetKind   `json:"asset_kinds,omitempty"`
	AllowedFileTypes []string      `json:"allowed_file_types,omitempty"`
	MaxFileSizeMB    int           `json:"max_file_size_mb"`
	TargetDirectory  string        `json:"target_directory"`
	CacheTargets     []CacheTarget `json:"cache_targets,omitempty"`
}

// FileUploadConfig captures the generic upload-related part of target_insert_specs.
type FileUploadConfig struct {
	Enabled          bool                               `json:"enabled"`
	ProfileKey       string                             `json:"profile_key,omitempty"`
	AssetKinds       []AssetKind                        `json:"asset_kinds,omitempty"`
	AllowedFileTypes []string                           `json:"allowed_file_types,omitempty"`
	FilenameColumn   string                             `json:"filename_column"`
	MaxFileSizeMB    int                                `json:"max_file_size_mb"`
	TargetDirectory  string                             `json:"target_directory"`
	CacheTargets     []CacheTarget                      `json:"cache_targets,omitempty"`
	Profiles         map[string]FileUploadProfileConfig `json:"profiles,omitempty"`
}

// AssetCapabilitySnapshot is the future status payload for one parent table.
type AssetCapabilitySnapshot struct {
	ParentTable   string                        `json:"parent_table"`
	ChildTable    string                        `json:"child_table"`
	StorageDriver string                        `json:"storage_driver"`
	Capabilities  map[AssetKind]CapabilityState `json:"capabilities"`
}

// FileUploadRelationStatus describes one file_upload relation row from FK metadata.
type FileUploadRelationStatus struct {
	RelationID       int              `json:"relation_id"`
	ParentTable      string           `json:"parent_table"`
	ChildTable       string           `json:"child_table"`
	ForeignKeyColumn string           `json:"foreign_key_column,omitempty"`
	StorageDriver    string           `json:"storage_driver"`
	UploadConfig     FileUploadConfig `json:"upload_config"`
}

const (
	RelationKindRelatedRows = "related_rows"
	RelationKindImageAsset  = "image_asset"
	RelationKindSharedAsset = "shared_asset"
)
