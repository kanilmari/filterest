// attachment_linking_status_handler.go
// Reads the current attachment-linking status payload from the shared asset_linking module.
// Bridges the new attachment admin view contract and the shared file_upload relation reader.
// Exists to expose the first live non-image asset capability in a stable API shape.
package dtt_asset_linking

import (
	"fmt"
	"net/http"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/httpresponse"
)

// GetAttachmentLinkingStatusHandler returns the current attachment-linking configuration for one or all tables.
func GetAttachmentLinkingStatusHandler(w http.ResponseWriter, r *http.Request) {
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
		"asset_linkings": buildAttachmentLinkingInfos(statuses),
	})
}
