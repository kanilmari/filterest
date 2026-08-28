// dataset_alias_handler.go
// Serves the admin-only dataset alias management read and write surface.
// Bridges router method/status handling with dataset_routes alias editor logic.
// Exists to keep alias management HTTP concerns separate from shared alias resolution helpers.
package router

import (
	"database/sql"
	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dataset_routes"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/httpresponse"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"
)

type saveDatasetAliasManagementRequest struct {
	DatasetName string `json:"dataset_name"`
	AliasSlug   string `json:"alias_slug"`
}

// GetDatasetAliasManagementHandler returns the admin alias editor read-model for all datasets.
func GetDatasetAliasManagementHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	snapshot, err := dataset_routes.LoadDatasetAliasManagementSnapshot(backend.Db)
	if err != nil {
		log.Printf("\033[31merror: load dataset alias management snapshot: %v\033[0m", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "error fetching dataset alias management data")
		return
	}

	httpresponse.RespondWithJSON(w, http.StatusOK, snapshot)
}

// SaveDatasetAliasManagementHandler creates, replaces, or clears one dataset's primary alias.
func SaveDatasetAliasManagementHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var req saveDatasetAliasManagementRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	tx, ok := dbutils.RequireTx(r.Context())
	if !ok {
		log.Printf("\033[31merror: [SaveDatasetAliasManagementHandler] failed to acquire transaction\033[0m")
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "transaction start failed")
		return
	}

	entry, err := dataset_routes.SavePrimaryAlias(tx, req.DatasetName, req.AliasSlug)
	if err != nil {
		var routeConflict *dataset_routes.RouteConflictError
		var validationErr *dataset_routes.AliasValidationError
		switch {
		case errors.Is(err, sql.ErrNoRows):
			httpresponse.RespondWithError(w, http.StatusNotFound, "dataset not found")
			return
		case errors.As(err, &routeConflict):
			httpresponse.RespondWithError(w, http.StatusConflict, routeConflict.Error())
			return
		case errors.As(err, &validationErr):
			httpresponse.RespondWithError(w, http.StatusBadRequest, validationErr.Error())
			return
		default:
			log.Printf("\033[31merror: [SaveDatasetAliasManagementHandler] save failed for %q: %v\033[0m", req.DatasetName, err)
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "error saving dataset alias")
			return
		}
	}

	message := "Dataset alias saved"
	if strings.TrimSpace(req.AliasSlug) == "" {
		message = "Dataset alias cleared"
	}

	httpresponse.RespondWithJSON(w, http.StatusOK, map[string]interface{}{
		"status":                             "ok",
		"message":                            message,
		"dataset":                            entry,
		"system_alias_policy_recommendation": dataset_routes.SystemAliasPolicyRecommendation(),
	})
}
