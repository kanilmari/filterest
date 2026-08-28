// image_asset_linking_types.go
// Defines the current image-asset-linking request and response payloads owned by asset_linking.
// Bridges the live image asset HTTP contract and the shared asset-linking internals.
// Exists to keep the image capability vocabulary aligned with the final asset-linking surface.
package dtt_asset_linking

type enableImageAssetLinkingRequest struct {
	ParentTable      string   `json:"parent_table"`
	MaxFileSizeMB    int      `json:"max_file_size_mb"`
	AllowedFileTypes []string `json:"allowed_file_types"`
}

type disableImageAssetLinkingRequest struct {
	ParentTable string `json:"parent_table"`
}

type removeImageAssetLinkingRequest struct {
	ParentTable string `json:"parent_table"`
	Confirm     bool   `json:"confirm"`
}

type updateImageAssetLinkingRequest struct {
	ParentTable      string   `json:"parent_table"`
	Enabled          *bool    `json:"enabled,omitempty"`
	MaxFileSizeMB    *int     `json:"max_file_size_mb,omitempty"`
	AllowedFileTypes []string `json:"allowed_file_types,omitempty"`
}

// ImageAssetLinkingInfo reports the current image asset status for one parent table.
type ImageAssetLinkingInfo struct {
	ParentTable      string      `json:"parent_table"`
	ChildTable       string      `json:"child_table"`
	ForeignKeyColumn string      `json:"foreign_key_column,omitempty"`
	RelationKind     string      `json:"relation_kind,omitempty"`
	Enabled          bool        `json:"enabled"`
	MaxFileSizeMB    interface{} `json:"max_file_size_mb"`
	AllowedFileTypes interface{} `json:"allowed_file_types"`
	RelationID       int         `json:"relation_id"`
}
