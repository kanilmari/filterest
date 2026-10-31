// dataset_ui_read_guard.go
// Applies current dataset visibility before ordinary and semantic row reads.
// Bridges the shared metadata policy and the two UI result handlers.
// Exists so stale navigation or an alternate search mode cannot reveal hidden rows.
package dtt_1_row_read

import (
	backend "easelect/backend/core_components"
	dataset_visibility "easelect/backend/core_components/dataset_visibility"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/httpresponse"
	"net/http"
)

func allowDatasetUIRead(w http.ResponseWriter, datasetName string, userID int) bool {
	return allowDatasetUIReadWithQuerier(w, datasetName, userID, backend.Db)
}

func allowDatasetUIReadWithQuerier(w http.ResponseWriter, datasetName string, userID int, q dbutils.Querier) bool {
	hidden, err := dataset_visibility.HiddenForUser(q, datasetName, userID)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusServiceUnavailable, "dataset visibility unavailable")
		return false
	}
	if hidden {
		w.Header().Set("Cache-Control", "no-store")
		httpresponse.RespondWithError(w, http.StatusNotFound, "dataset not found")
		return false
	}
	return true
}
