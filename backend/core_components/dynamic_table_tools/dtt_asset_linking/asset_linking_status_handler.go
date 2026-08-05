// asset_linking_status_handler.go
// Builds and serves combined image and attachment asset-linking status responses.
// Bridges asset-linking relation readers and the admin/UI status endpoint.
// Exists so the frontend can inspect current asset-linking configuration from one route.
package dtt_asset_linking

import (
	"fmt"
	"net/http"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/httpresponse"
)

type AssetLinkingStatusResponse struct {
	ImageAssetLinkings      []ImageAssetLinkingInfo `json:"image_asset_linkings"`
	AttachmentAssetLinkings []AttachmentLinkingInfo `json:"attachment_asset_linkings"`
}

func buildImageAssetLinkingInfos(statuses []FileUploadRelationStatus) []ImageAssetLinkingInfo {
	filteredStatuses := FilterFileUploadRelationStatusesByProfile(statuses, AssetProfileImage)
	results := make([]ImageAssetLinkingInfo, 0, len(filteredStatuses))
	for _, status := range filteredStatuses {
		profileConfig, ok := ResolveProfileUploadConfigFromStatus(status, AssetProfileImage)
		if !ok {
			continue
		}
		results = append(results, ImageAssetLinkingInfo{
			ParentTable:      status.ParentTable,
			ChildTable:       status.ChildTable,
			ForeignKeyColumn: status.ForeignKeyColumn,
			RelationKind:     ResolveRelationKindForProfile(status, AssetProfileImage),
			Enabled:          profileConfig.Enabled,
			MaxFileSizeMB:    profileConfig.MaxFileSizeMB,
			AllowedFileTypes: profileConfig.AllowedFileTypes,
			RelationID:       status.RelationID,
		})
	}
	return results
}

func buildAttachmentLinkingInfos(statuses []FileUploadRelationStatus) []AttachmentLinkingInfo {
	filteredStatuses := FilterFileUploadRelationStatusesByProfile(statuses, AssetProfileAttachment)
	results := make([]AttachmentLinkingInfo, 0, len(filteredStatuses))
	for _, status := range filteredStatuses {
		profileConfig, ok := ResolveProfileUploadConfigFromStatus(status, AssetProfileAttachment)
		if !ok {
			continue
		}
		results = append(results, AttachmentLinkingInfo{
			ParentTable:      status.ParentTable,
			ChildTable:       status.ChildTable,
			ForeignKeyColumn: status.ForeignKeyColumn,
			RelationKind:     ResolveRelationKindForProfile(status, AssetProfileAttachment),
			Enabled:          profileConfig.Enabled,
			MaxFileSizeMB:    profileConfig.MaxFileSizeMB,
			AllowedFileTypes: profileConfig.AllowedFileTypes,
			AssetKinds:       append([]AssetKind(nil), profileConfig.AssetKinds...),
			RelationID:       status.RelationID,
		})
	}
	return results
}

// GetAssetLinkingStatusHandler returns both image and attachment status payloads for one or all tables.
func GetAssetLinkingStatusHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "only GET method is allowed")
		return
	}

	tableName := r.URL.Query().Get("table")
	statuses, err := ListFileUploadRelationStatuses(backend.Db, tableName)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("%v", err))
		return
	}

	httpresponse.RespondWithJSON(w, http.StatusOK, AssetLinkingStatusResponse{
		ImageAssetLinkings:      buildImageAssetLinkingInfos(statuses),
		AttachmentAssetLinkings: buildAttachmentLinkingInfos(statuses),
	})
}
