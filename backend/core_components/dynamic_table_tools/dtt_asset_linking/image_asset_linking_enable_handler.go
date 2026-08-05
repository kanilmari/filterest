// image_asset_linking_enable_handler.go
// Enables the current image asset capability from inside the shared asset_linking module.
// Bridges the admin image-asset endpoint and the shared asset-relation builders.
// Exists to keep image uploads on the final asset-linking contract instead of a legacy image-only path.
package dtt_asset_linking

import (
	"encoding/json"
	"fmt"
	"net/http"

	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/httpresponse"
	"easelect/backend/core_components/security"
)

// EnableImageAssetLinkingHandler creates or reuses the canonical shared asset relation for one parent table.
func EnableImageAssetLinkingHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "only POST method is allowed")
		return
	}

	var req enableImageAssetLinkingRequest
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
		maxSize = 10
	}

	allowedTypes := append([]string(nil), req.AllowedFileTypes...)
	if len(allowedTypes) == 0 {
		allowedTypes = append([]string(nil), DefaultImageAllowedTypes...)
	}

	tx, ok := dbutils.RequireTx(r.Context())
	if !ok {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "transaction not available")
		return
	}

	var parentTableUID int
	err = tx.QueryRow(
		"SELECT table_uid FROM system_db_tables WHERE table_name = $1 AND schema_name = 'public'",
		parentTable,
	).Scan(&parentTableUID)
	if err != nil {
		_ = tx.Rollback()
		httpresponse.RespondWithError(w, http.StatusBadRequest, fmt.Sprintf("parent table '%s' not found in system_db_tables", parentTable))
		return
	}

	if err := EnsureCachedImageColumn(tx, parentTable); err != nil {
		_ = tx.Rollback()
		httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("failed to ensure cached_image column: %v", err))
		return
	}

	imageProfile := BuildImageProfileConfig(parentTable, maxSize, allowedTypes)

	if existingStatus, err := FindFileUploadRelationStatusByProfile(tx, parentTableUID, AssetProfileImage); err == nil {
		uploadConfig := SetProfileUploadConfig(existingStatus.UploadConfig, AssetProfileImage, imageProfile)
		if saveErr := SaveFileUploadConfigByRelationID(tx, existingStatus.RelationID, uploadConfig); saveErr != nil {
			_ = tx.Rollback()
			httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("failed to update image asset specs: %v", saveErr))
			return
		}

		httpresponse.RespondWithJSON(w, http.StatusOK, map[string]interface{}{
			"message":       fmt.Sprintf("Image assets enabled for table '%s'", parentTable),
			"child_table":   existingStatus.ChildTable,
			"parent_table":  parentTable,
			"reused_table":  true,
			"relation_id":   existingStatus.RelationID,
			"allowed_types": imageProfile.AllowedFileTypes,
		})
		return
	} else if err != ErrFileUploadProfileNotFound {
		_ = tx.Rollback()
		httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("failed to inspect image asset state: %v", err))
		return
	}

	initialConfig := BuildImageFileUploadConfig(parentTable, maxSize, allowedTypes)
	relationStatus, reusedRelation, err := EnsureSharedAssetRelation(tx, parentTable, parentTableUID, initialConfig)
	if err != nil {
		_ = tx.Rollback()
		httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("failed to ensure shared asset relation: %v", err))
		return
	}

	uploadConfig := SetProfileUploadConfig(relationStatus.UploadConfig, AssetProfileImage, imageProfile)
	if err := SaveFileUploadConfigByRelationID(tx, relationStatus.RelationID, uploadConfig); err != nil {
		_ = tx.Rollback()
		httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("failed to persist image asset specs: %v", err))
		return
	}

	httpresponse.RespondWithJSON(w, http.StatusCreated, map[string]interface{}{
		"message":      fmt.Sprintf("Image assets enabled for table '%s'", parentTable),
		"child_table":  relationStatus.ChildTable,
		"parent_table": parentTable,
		"reused_table": reusedRelation,
		"relation_id":  relationStatus.RelationID,
	})
}
