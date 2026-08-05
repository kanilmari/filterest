// image_asset_linking_disable_handler.go
// Soft-disables the current image asset capability from the shared asset_linking module.
// Bridges the image asset admin endpoint and the shared file_upload profile editor.
// Exists to hide image uploads without reviving the removed image-only compatibility surface.
package dtt_asset_linking

import (
	"encoding/json"
	"fmt"
	"net/http"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/httpresponse"
	"easelect/backend/core_components/security"
)

// DisableImageAssetLinkingHandler hides the upload UI by setting the image profile enabled flag to false.
func DisableImageAssetLinkingHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "only POST method is allowed")
		return
	}

	var req disableImageAssetLinkingRequest
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
		httpresponse.RespondWithError(w, http.StatusNotFound, fmt.Sprintf("no image assets found for table '%s'", parentTable))
		return
	}
	profileConfig.Enabled = false
	uploadConfig := SetProfileUploadConfig(status.UploadConfig, AssetProfileImage, profileConfig)

	if err := SaveFileUploadConfigByRelationID(backend.Db, status.RelationID, uploadConfig); err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("failed to disable image assets: %v", err))
		return
	}

	httpresponse.RespondWithJSON(w, http.StatusOK, map[string]interface{}{
		"message":      fmt.Sprintf("Image assets disabled for table '%s'", parentTable),
		"parent_table": parentTable,
	})
}
