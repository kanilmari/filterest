// attachment_linking_disable_handler.go
// Soft-disables the attachment-linking capability from the shared asset_linking module.
// Bridges the new attachment admin endpoint and the generic file_upload relation editor.
// Exists to let attachment linking be toggled without deleting the shared asset table.
package dtt_asset_linking

import (
	"encoding/json"
	"fmt"
	"net/http"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/httpresponse"
	"easelect/backend/core_components/security"
)

// DisableAttachmentLinkingHandler hides attachment upload UI by setting file_upload.enabled to false.
func DisableAttachmentLinkingHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "only POST method is allowed")
		return
	}

	var req disableAttachmentLinkingRequest
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

	status, err := FindFileUploadRelationStatusByProfile(backend.Db, parentTableUID, AssetProfileAttachment)
	if err != nil {
		if err == ErrFileUploadProfileNotFound {
			httpresponse.RespondWithError(w, http.StatusNotFound, fmt.Sprintf("no attachment linking found for table '%s'", parentTable))
			return
		}
		httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("failed to load attachment linking: %v", err))
		return
	}

	profileConfig, ok := ResolveProfileUploadConfigFromStatus(status, AssetProfileAttachment)
	if !ok {
		httpresponse.RespondWithError(w, http.StatusNotFound, fmt.Sprintf("no attachment linking found for table '%s'", parentTable))
		return
	}
	profileConfig.Enabled = false
	uploadConfig := SetProfileUploadConfig(status.UploadConfig, AssetProfileAttachment, profileConfig)

	if err := SaveFileUploadConfigByRelationID(backend.Db, status.RelationID, uploadConfig); err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("failed to disable attachment linking: %v", err))
		return
	}

	httpresponse.RespondWithJSON(w, http.StatusOK, map[string]interface{}{
		"message":      fmt.Sprintf("Attachment linking disabled (soft) for table '%s'", parentTable),
		"parent_table": parentTable,
	})
}
