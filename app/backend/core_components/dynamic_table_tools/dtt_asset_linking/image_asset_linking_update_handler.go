// image_asset_linking_update_handler.go
// Updates the current image asset configuration inside the shared asset_linking module.
// Bridges the image asset admin endpoint and the shared file_upload profile editor.
// Exists to keep image capability changes on the final asset-linking surface.
package dtt_asset_linking

import (
	"encoding/json"
	"fmt"
	"net/http"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/httpresponse"
	"easelect/backend/core_components/security"
)

// UpdateImageAssetLinkingHandler edits file_upload configuration for one image asset relation.
func UpdateImageAssetLinkingHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "only POST method is allowed")
		return
	}

	var req updateImageAssetLinkingRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, fmt.Sprintf("invalid request body: %v", err))
		return
	}

	parentTable, err := security.SanitizeIdentifier(req.ParentTable)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, fmt.Sprintf("invalid parent table name: %v", err))
		return
	}

	parentTableUID, err := LookupParentTableUID(backend.Db, parentTable)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, fmt.Sprintf("parent table '%s' not found", parentTable))
		return
	}

	status, err := FindFileUploadRelationStatusByProfile(backend.Db, parentTableUID, AssetProfileImage)
	if err != nil {
		if err == ErrFileUploadProfileNotFound {
			httpresponse.RespondWithError(w, http.StatusNotFound, fmt.Sprintf("no image assets found for table '%s'", parentTable))
			return
		}
		httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("failed to load image asset config: %v", err))
		return
	}
	profileConfig, ok := ResolveProfileUploadConfigFromStatus(status, AssetProfileImage)
	if !ok {
		httpresponse.RespondWithError(w, http.StatusNotFound, fmt.Sprintf("no image asset config found for table '%s'", parentTable))
		return
	}

	if req.Enabled != nil {
		profileConfig.Enabled = *req.Enabled
	}
	if req.MaxFileSizeMB != nil {
		profileConfig.MaxFileSizeMB = *req.MaxFileSizeMB
	}
	if len(req.AllowedFileTypes) > 0 {
		profileConfig.AllowedFileTypes = append([]string(nil), req.AllowedFileTypes...)
	}
	uploadConfig := SetProfileUploadConfig(status.UploadConfig, AssetProfileImage, profileConfig)

	if err := SaveFileUploadConfigByRelationID(backend.Db, status.RelationID, uploadConfig); err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("failed to update specs: %v", err))
		return
	}

	specs := BuildTargetInsertSpecs(uploadConfig)

	httpresponse.RespondWithJSON(w, http.StatusOK, map[string]interface{}{
		"message":       fmt.Sprintf("Image asset configuration updated for table '%s'", parentTable),
		"parent_table":  parentTable,
		"updated_specs": specs,
	})
}
