// system_automation_account_handler.go
// Exposes trusted status and provisioning for the fixed Filterest API automation account.
// Bridges the system-manager peer/token boundary with the atomic authentication service.
// Exists so account bootstrap stays outside public registration and browser-admin credentials.
package router

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/auth"
	"easelect/backend/core_components/auth/credentials"
	"easelect/backend/core_components/httpresponse"
	"easelect/backend/core_components/logging"
)

const systemAutomationAccountBodyLimit = 4096

type systemAutomationAccountRequest struct {
	Password string `json:"password"`
}

// systemAutomationAccountHandler returns non-secret readiness on GET and
// atomically creates or rotates the fixed account on POST. Both methods require
// the same exact trusted peer and bearer token as the system drain endpoint.
func systemAutomationAccountHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if r.Method != http.MethodGet && r.Method != http.MethodPost {
		w.Header().Set("Allow", "GET, POST")
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	if rejectDisallowedSystemAutomationAccountRequest(w, r) {
		return
	}
	var request systemAutomationAccountRequest
	var err error
	if r.Method == http.MethodPost {
		request, err = decodeSystemAutomationAccountRequest(w, r)
		if err != nil {
			httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid_request_body")
			return
		}
	}
	if backend.DbAdmin == nil {
		httpresponse.RespondWithError(w, http.StatusServiceUnavailable, "database_unavailable")
		return
	}

	provisioner := auth.NewAutomationAccountProvisioner(backend.DbAdmin)
	if r.Method == http.MethodGet {
		record, err := provisioner.Status(r.Context())
		respondWithSystemAutomationAccountResult(w, record, err)
		return
	}

	record, err := provisioner.Provision(r.Context(), request.Password)
	respondWithSystemAutomationAccountResult(w, record, err)
}

func rejectDisallowedSystemAutomationAccountRequest(w http.ResponseWriter, r *http.Request) bool {
	if systemDrainManagerRequestAllowed(r) {
		return false
	}
	httpresponse.RespondWithError(w, http.StatusForbidden, "automation_account_control_not_authorized")
	return true
}

func decodeSystemAutomationAccountRequest(w http.ResponseWriter, r *http.Request) (systemAutomationAccountRequest, error) {
	var request systemAutomationAccountRequest
	if r.Body == nil || r.Body == http.NoBody {
		return request, errors.New("request body is required")
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, systemAutomationAccountBodyLimit))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		return request, err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return request, errors.New("request body must contain one JSON object")
	}
	if request.Password == "" {
		return request, errors.New("password is required")
	}
	return request, nil
}

func respondWithSystemAutomationAccountResult(w http.ResponseWriter, record auth.AutomationAccountRecord, err error) {
	switch {
	case err == nil:
		httpresponse.RespondWithJSON(w, http.StatusOK, record)
	case errors.Is(err, credentials.ErrInvalidPassword):
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid_password")
	case errors.Is(err, auth.ErrAutomationAccountConflict):
		httpresponse.RespondWithError(w, http.StatusConflict, "automation_account_identity_conflict")
	case errors.Is(err, auth.ErrAutomationAccountUnavailable):
		httpresponse.RespondWithError(w, http.StatusServiceUnavailable, "automation_account_unavailable")
	default:
		logging.Errorf("[systemAutomationAccountHandler] operation failed: %v", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "automation_account_operation_failed")
	}
}
