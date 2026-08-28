// data_retention_admin_handler.go
// Exposes admin-only preview and prune endpoints for configurable data retention.
// Bridges authenticated maintenance requests and the shared retention engine with JSON HTTP responses.
// Exists so operators can validate and execute retention without direct SQL workarounds.
package system_table_tools

import (
	"encoding/json"
	"log"
	"net/http"
	"time"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/httpresponse"
)

type dataRetentionRequest struct {
	Policies []string `json:"policies"`
	DryRun   bool     `json:"dry_run"`
}

// PreviewDataRetentionHandler calculates how many rows each configured policy would prune.
func PreviewDataRetentionHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "only GET allowed")
		return
	}
	if backend.Db == nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "database unavailable")
		return
	}

	policies, err := loadDataRetentionPolicies(backend.Db)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, err.Error())
		return
	}
	selectedPolicies, err := resolveRequestedDataRetentionPolicies(
		parseDataRetentionPoliciesQuery(r.URL.Query().Get("policies")),
		policies,
	)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
		return
	}

	response, err := runDataRetentionAt(backend.Db, selectedPolicies, true, time.Now())
	if err != nil {
		log.Printf("\033[31merror: [PreviewDataRetentionHandler] %v\033[0m", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "data retention preview failed")
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// PruneDataRetentionHandler deletes rows matched by the selected retention policies.
func PruneDataRetentionHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "only POST allowed")
		return
	}

	var req dataRetentionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	policies, err := loadDataRetentionPolicies(backend.Db)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, err.Error())
		return
	}
	selectedPolicies, err := resolveRequestedDataRetentionPolicies(req.Policies, policies)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
		return
	}

	tx, ok := dbutils.RequireTx(r.Context())
	if !ok {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "failed to acquire transaction")
		return
	}

	response, err := runDataRetentionAt(tx, selectedPolicies, req.DryRun, time.Now())
	if err != nil {
		log.Printf("\033[31merror: [PruneDataRetentionHandler] %v\033[0m", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "data retention prune failed")
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}
