// attachment_linking_types.go
// Defines the first attachment-linking request and response payloads under asset_linking.
// Bridges the new attachment admin/API contract and the shared file_upload scaffolding.
// Exists to add a real non-image capability without widening the old image-linking contract.
package dtt_asset_linking

type enableAttachmentLinkingRequest struct {
	ParentTable      string   `json:"parent_table"`
	MaxFileSizeMB    int      `json:"max_file_size_mb"`
	AllowedFileTypes []string `json:"allowed_file_types"`
}

type disableAttachmentLinkingRequest struct {
	ParentTable string `json:"parent_table"`
}

type removeAttachmentLinkingRequest struct {
	ParentTable string `json:"parent_table"`
	Confirm     bool   `json:"confirm"`
}

// AttachmentLinkingInfo reports the current attachment-linking state for one parent table.
type AttachmentLinkingInfo struct {
	ParentTable      string      `json:"parent_table"`
	ChildTable       string      `json:"child_table"`
	ForeignKeyColumn string      `json:"foreign_key_column,omitempty"`
	RelationKind     string      `json:"relation_kind,omitempty"`
	Enabled          bool        `json:"enabled"`
	MaxFileSizeMB    interface{} `json:"max_file_size_mb"`
	AllowedFileTypes interface{} `json:"allowed_file_types"`
	AssetKinds       []AssetKind `json:"asset_kinds"`
	RelationID       int         `json:"relation_id"`
}
