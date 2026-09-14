// dataset_ui_visibility.go
// Reads and changes the reversible visibility of one registered dataset.
// Bridges the administrator Manage table dialog and canonical dataset metadata.
// Exists to hide and restore without deleting data, media or permissions.
package system_table_tools

import (
	"database/sql"
	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/httpresponse"
	"easelect/backend/core_components/security"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
)

type datasetUIVisibility struct {
	DatasetName string `json:"dataset_name"`
	UIHidden    bool   `json:"ui_hidden"`
}
type datasetUIVisibilityRequest struct {
	DatasetName string `json:"dataset_name"`
	UIHidden    *bool  `json:"ui_hidden"`
}

// A scalar UID lookup rejects ambiguous legacy public/NULL metadata rather than
// selecting arbitrarily or updating several datasets.
const readDatasetUIVisibilityQuery = `
 SELECT table_name, ui_hidden
 FROM public.system_db_tables
 WHERE table_uid = (
  SELECT table_uid FROM public.system_db_tables
  WHERE table_name = $1
    AND COALESCE(NULLIF(schema_name, ''), 'public') = 'public'
 )
`
const updateDatasetUIVisibilityQuery = `
 UPDATE public.system_db_tables
 SET ui_hidden = $2, updated = now()
 WHERE table_uid = (
  SELECT table_uid FROM public.system_db_tables
  WHERE table_name = $1
    AND COALESCE(NULLIF(schema_name, ''), 'public') = 'public'
 )
 RETURNING table_name, ui_hidden
`

// AdminDatasetUIVisibilityHandler uses AdminProfile: authentication, CSRF,
// route permission and admin checks. POST requires an explicit boolean and
// changes only UI metadata; GET reads the same current state.
func AdminDatasetUIVisibilityHandler(w http.ResponseWriter, r *http.Request) {
	var req datasetUIVisibilityRequest
	switch r.Method {
	case http.MethodGet:
		req.DatasetName = r.URL.Query().Get("dataset_name")
	case http.MethodPost:
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&req); err != nil {
			httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid request body")
			return
		}
		if err := decoder.Decode(&struct{}{}); err != io.EOF || req.UIHidden == nil {
			httpresponse.RespondWithError(w, http.StatusBadRequest, "explicit ui_hidden boolean is required")
			return
		}
	default:
		w.Header().Set("Allow", "GET, POST")
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if req.DatasetName == "" {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "dataset_name is required")
		return
	}
	if _, err := security.SanitizeIdentifier(req.DatasetName); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid dataset_name")
		return
	}
	var row *sql.Row
	if r.Method == http.MethodPost {
		tx, ok := dbutils.RequireTx(r.Context())
		if !ok {
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "transaction start failed")
			return
		}
		row = tx.QueryRow(updateDatasetUIVisibilityQuery, req.DatasetName, *req.UIHidden)
	} else {
		row = dbutils.GetQuerier(r.Context(), backend.Db).QueryRow(readDatasetUIVisibilityQuery, req.DatasetName)
	}
	var result datasetUIVisibility
	if err := row.Scan(&result.DatasetName, &result.UIHidden); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			httpresponse.RespondWithError(w, http.StatusNotFound, "dataset not found")
		} else {
			log.Printf("[AdminDatasetUIVisibilityHandler] metadata operation failed: %v", err)
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "dataset visibility unavailable")
		}
		return
	}
	// Readers deliberately do not cache ui_hidden: the next request observes the
	// committed hide or restore without permission changes or unrelated writes.
	w.Header().Set("Cache-Control", "no-store")
	httpresponse.RespondWithJSON(w, http.StatusOK, result)
}
