// asset_linking_formatter.go
// Formats and parses target_insert_specs payloads for asset child relations.
// Bridges typed asset-linking config and the JSONB file_upload shape stored in FK metadata.
// Exists to keep file_upload encoding and decoding centralized during the image-linking migration.
package dtt_asset_linking

import (
	"encoding/json"
	"errors"
)

var ErrMissingFileUploadConfig = errors.New("missing file_upload config")

type targetInsertSpecsEnvelope struct {
	FileUpload *FileUploadConfig `json:"file_upload"`
}

// BuildTargetInsertSpecsJSON marshals typed upload config into the FK metadata JSON payload.
func BuildTargetInsertSpecsJSON(uploadConfig FileUploadConfig) ([]byte, error) {
	return json.Marshal(BuildTargetInsertSpecs(uploadConfig))
}

// ParseFileUploadConfig decodes one file_upload config from target_insert_specs JSON.
func ParseFileUploadConfig(specsJSON []byte) (FileUploadConfig, error) {
	var envelope targetInsertSpecsEnvelope
	if err := json.Unmarshal(specsJSON, &envelope); err != nil {
		return FileUploadConfig{}, err
	}
	if envelope.FileUpload == nil {
		return FileUploadConfig{}, ErrMissingFileUploadConfig
	}

	return NormalizeFileUploadConfig(*envelope.FileUpload), nil
}
