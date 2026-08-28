// image_asset_linking_status_handler.go
// Reads the current image asset status payload from the shared asset_linking module.
// Bridges the image asset admin UI and the shared file_upload relation reader.
// Exists to expose image capability status without carrying removed image-only compat naming.
package dtt_asset_linking

import (
	"fmt"
	"net/http"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/httpresponse"
)

// GetImageAssetLinkingStatusHandler returns the current image asset configuration for one or all tables.
func GetImageAssetLinkingStatusHandler(w http.ResponseWriter, r *http.Request) {
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

	httpresponse.RespondWithJSON(w, http.StatusOK, map[string]interface{}{
		"asset_linkings": buildImageAssetLinkingInfos(statuses),
	})
}
