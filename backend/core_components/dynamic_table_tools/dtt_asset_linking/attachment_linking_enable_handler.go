// attachment_linking_enable_handler.go
// Enables the first attachment-linking capability inside the shared asset_linking module.
// Bridges the new attachment admin endpoint and the canonical parent_assets child-table direction.
// Exists to add a real non-image asset contract without changing the legacy image endpoints.
package dtt_asset_linking

import (
	"encoding/json"
	"fmt"
	"net/http"

	"easelect/backend/core_components/dbutils"
	attachmentprofile "easelect/backend/core_components/dynamic_table_tools/dtt_asset_linking/profiles/attachment"
	"easelect/backend/core_components/httpresponse"
	"easelect/backend/core_components/security"
)

// EnableAttachmentLinkingHandler creates or re-enables the shared attachment asset table for one parent table.
func EnableAttachmentLinkingHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "only POST method is allowed")
		return
	}

	var req enableAttachmentLinkingRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, fmt.Sprintf("invalid request body: %v", err))
		return
	}

	parentTable, err := security.SanitizeIdentifier(req.ParentTable)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, fmt.Sprintf("invalid parent table name: %v", err))
		return
	}

	maxSize := req.MaxFileSizeMB
	if maxSize <= 0 {
		maxSize = 25
	}

	allowedTypes := append([]string(nil), req.AllowedFileTypes...)
	if len(allowedTypes) == 0 {
		allowedTypes = attachmentprofile.DefaultAllowedFileTypes()
	}

	tx, ok := dbutils.RequireTx(r.Context())
	if !ok {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "transaction not available")
		return
	}

	parentTableUID, err := LookupParentTableUID(tx, parentTable)
	if err != nil {
		_ = tx.Rollback()
		httpresponse.RespondWithError(w, http.StatusBadRequest, fmt.Sprintf("parent table '%s' not found in system_db_tables", parentTable))
		return
	}

	attachmentProfile := BuildAttachmentProfileConfig(parentTable, maxSize, allowedTypes)

	if existingStatus, err := FindFileUploadRelationStatusByProfile(tx, parentTableUID, AssetProfileAttachment); err == nil {
		uploadConfig := SetProfileUploadConfig(existingStatus.UploadConfig, AssetProfileAttachment, attachmentProfile)

		if err := SaveFileUploadConfigByRelationID(tx, existingStatus.RelationID, uploadConfig); err != nil {
			_ = tx.Rollback()
			httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("failed to update attachment specs: %v", err))
			return
		}

		httpresponse.RespondWithJSON(w, http.StatusOK, map[string]interface{}{
			"message":       fmt.Sprintf("Attachment linking enabled for table '%s'", parentTable),
			"child_table":   existingStatus.ChildTable,
			"parent_table":  parentTable,
			"reused_table":  true,
			"relation_id":   existingStatus.RelationID,
			"allowed_types": attachmentProfile.AllowedFileTypes,
		})
		return
	} else if err != ErrFileUploadProfileNotFound {
		_ = tx.Rollback()
		httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("failed to inspect attachment linking state: %v", err))
		return
	}

	initialConfig := BuildAttachmentFileUploadConfig(parentTable, maxSize, allowedTypes)
	relationStatus, reusedRelation, err := EnsureSharedAssetRelation(tx, parentTable, parentTableUID, initialConfig)
	if err != nil {
		_ = tx.Rollback()
		httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("failed to ensure shared asset relation: %v", err))
		return
	}

	uploadConfig := SetProfileUploadConfig(relationStatus.UploadConfig, AssetProfileAttachment, attachmentProfile)
	if err := SaveFileUploadConfigByRelationID(tx, relationStatus.RelationID, uploadConfig); err != nil {
		_ = tx.Rollback()
		httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("failed to persist attachment specs: %v", err))
		return
	}

	httpresponse.RespondWithJSON(w, http.StatusCreated, map[string]interface{}{
		"message":      fmt.Sprintf("Attachment linking enabled for table '%s'", parentTable),
		"child_table":  relationStatus.ChildTable,
		"parent_table": parentTable,
		"reused_table": reusedRelation,
		"relation_id":  relationStatus.RelationID,
	})
}
