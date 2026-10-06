// image_asset_linking_disable_handler.go
// Soft-disables the current image asset capability from the shared asset_linking module.
// Bridges the image asset admin endpoint and the shared file_upload profile editor.
// Exists to hide image uploads without reviving the removed image-only compatibility surface.
package dtt_asset_linking

import (
	"encoding/json"
	"fmt"
	"net/http"

	"easelect/backend/core_components/httpresponse"
	"easelect/backend/core_components/runtime_grant_mutations"
	"easelect/backend/core_components/security"
)

// DisableImageAssetLinkingHandler hides the upload UI by setting the image profile enabled flag to false.
func DisableImageAssetLinkingHandler(w http.ResponseWriter, r *http.Request) {

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

	mutation, err := runtime_grant_mutations.Begin(r.Context(), w)
	if err != nil {
		runtime_grant_mutations.RespondError(w, err)
		return
	}
	tx := mutation.Tx

	parentTableUID, err := LookupParentTableUID(tx, parentTable)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, fmt.Sprintf("parent table '%s' not found", parentTable))
		return
	}

	status, err := FindFileUploadRelationStatusByProfile(tx, parentTableUID, AssetProfileImage)
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

	if err := SaveFileUploadConfigByRelationID(tx, status.RelationID, uploadConfig); err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("failed to disable image assets: %v", err))
		return
	}

	if err := mutation.Finish(r.Context(), int64(parentTableUID)); err != nil {
		runtime_grant_mutations.RespondError(w, err)
		return
	}

	httpresponse.RespondWithJSON(w, http.StatusOK, map[string]interface{}{
		"message":      fmt.Sprintf("Image assets disabled for table '%s'", parentTable),
		"parent_table": parentTable,
	})
}
