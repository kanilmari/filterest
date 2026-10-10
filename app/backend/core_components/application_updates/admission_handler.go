// admission_handler.go
// Exposes guarded application-update information, requests, proofs and decisions.
// Connects administrator routes to lazy transactions and durable admission services.
// Buffers success until commit and exposes neither credentials nor execution privileges.
package application_updates

import (
	"database/sql"
	backend "easelect/backend/core_components"
	"easelect/backend/core_components/auth"
	"easelect/backend/core_components/auth_generation"
	"easelect/backend/core_components/context_keys"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/httpresponse"
	"easelect/backend/core_components/runtime_grants"
	e_sessions "easelect/backend/core_components/sessions"
	"easelect/backend/core_components/sign_in_deadline"
	"easelect/backend/core_components/sign_in_revocation"
	"easelect/backend/core_components/update_capability"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"time"
)

func beginAdmission(w http.ResponseWriter, r *http.Request, requireGrant bool) (*sql.Tx, Authorization, error) {
	var actor Authorization
	w.Header().Set("Cache-Control", "no-store")
	if err := httpresponse.EnableCommitBuffer(w); err != nil {
		return nil, actor, err
	}
	tx, err := dbutils.RequireTxWithError(r.Context())
	if err != nil {
		return nil, actor, err
	}
	if err = runtime_grants.LockRuntimeGrantPolicy(r.Context(), tx); err != nil {
		return nil, actor, err
	}
	session, err := e_sessions.Load(r)
	if err != nil || session == nil || session.Values["authenticated"] != true {
		return nil, actor, refuse("authorization_revoked", http.StatusUnauthorized)
	}
	actor.ActorID, _ = session.Values["user_id"].(int)
	actor.Generation, _ = auth_generation.SessionValue(session)
	actor.SignInID, _ = sign_in_revocation.SessionValue(session)
	actor.SignInExpiresAt, _ = sign_in_deadline.SessionValue(session)
	if requireGrant {
		err = RecheckAuthorization(r.Context(), tx, actor)
	} else {
		current, checkErr := backend.AuthenticatedSessionMatches(r.Context(), tx, session, actor.ActorID)
		err = checkErr
		if err == nil && !current {
			err = refuse("authorization_revoked", http.StatusUnauthorized)
		}
	}
	return tx, actor, err
}

func decodeBody(w http.ResponseWriter, r *http.Request, out interface{}) error {
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(out); err != nil {
		return refuse("invalid_request", http.StatusBadRequest)
	}
	var trailing interface{}
	if err := decoder.Decode(&trailing); err != io.EOF {
		return refuse("invalid_request", http.StatusBadRequest)
	}
	return nil
}

func respondFailure(w http.ResponseWriter, err error) {
	code, status := "admission_unavailable", http.StatusServiceUnavailable
	var rejected *refusal
	if errors.As(err, &rejected) {
		code, status = rejected.code, rejected.status
	}
	httpresponse.RespondWithJSON(w, status, ErrorResponse{ProtocolVersion: ProtocolVersion, Code: code, ErrorLangKey: "error_application_update_" + code})
}

// StatusHandler returns only installation-local signed offer and sanitized job facts.
func StatusHandler(w http.ResponseWriter, r *http.Request) {
	tx, actor, err := beginAdmission(w, r, false)
	if err != nil {
		respondFailure(w, err)
		return
	}
	state, err := loadControl(r.Context(), tx)
	if err != nil {
		respondFailure(w, err)
		return
	}
	if err = expireQueued(r.Context(), tx, time.Now()); err != nil {
		respondFailure(w, err)
		return
	}
	response := StatusResponse{ProtocolVersion: ProtocolVersion, InstallationID: state.installationID, ExecutorAvailable: state.available, Offer: state.offer}
	response.CanUpdate, err = update_capability.Granted(r.Context(), tx, actor.ActorID)
	if err != nil {
		respondFailure(w, err)
		return
	}
	var raw []byte
	err = tx.QueryRowContext(r.Context(), `SELECT payload FROM restricted.system_application_update_jobs ORDER BY active DESC, created_at DESC LIMIT 1`).Scan(&raw)
	if err == nil {
		response.LatestJob = &Job{}
		err = json.Unmarshal(raw, response.LatestJob)
	}
	if err != nil && err != sql.ErrNoRows {
		respondFailure(w, err)
		return
	}
	httpresponse.RespondWithJSON(w, http.StatusOK, response)
}

// RequestHandler durably admits one request without starting an executor.
func RequestHandler(w http.ResponseWriter, r *http.Request) {
	tx, actor, err := beginAdmission(w, r, true)
	if err != nil {
		respondFailure(w, err)
		return
	}
	var request Request
	if err = decodeBody(w, r, &request); err != nil {
		respondFailure(w, err)
		return
	}
	job, err := AdmitRequest(r.Context(), tx, actor, request, time.Now())
	if err != nil {
		respondFailure(w, err)
		return
	}
	httpresponse.RespondWithJSON(w, http.StatusAccepted, job)
}

// JobHandler retrieves one sanitized durable job for any current administrator.
func JobHandler(w http.ResponseWriter, r *http.Request) {
	tx, _, err := beginAdmission(w, r, false)
	if err != nil {
		respondFailure(w, err)
		return
	}
	id := r.PathValue("id")
	if !identityPattern.MatchString(id) {
		respondFailure(w, refuse("invalid_request", http.StatusBadRequest))
		return
	}
	if err = expireQueued(r.Context(), tx, time.Now()); err != nil {
		respondFailure(w, err)
		return
	}
	job, err := loadJob(r.Context(), tx, id)
	if err != nil {
		respondFailure(w, err)
		return
	}
	httpresponse.RespondWithJSON(w, http.StatusOK, job)
}

// DecisionHandler admits acceptance/refusal intent against the exact reopened evidence.
func DecisionHandler(w http.ResponseWriter, r *http.Request) {
	tx, actor, err := beginAdmission(w, r, true)
	if err != nil {
		respondFailure(w, err)
		return
	}
	id := r.PathValue("id")
	if !identityPattern.MatchString(id) {
		respondFailure(w, refuse("invalid_request", http.StatusBadRequest))
		return
	}
	var request DecisionRequest
	if err = decodeBody(w, r, &request); err != nil {
		respondFailure(w, err)
		return
	}
	receipt, err := AdmitDecision(r.Context(), tx, actor, id, request, time.Now())
	if err != nil {
		respondFailure(w, err)
		return
	}
	httpresponse.RespondWithJSON(w, http.StatusAccepted, receipt)
}

// ReauthenticationHandler issues an evidence-bound proof after all configured factors.
func ReauthenticationHandler(w http.ResponseWriter, r *http.Request) {
	// Reserve independently before opening the admission transaction. Failure and
	// rollback must not restore an attacker's password/factor guessing budget.
	session, err := e_sessions.Load(r)
	if err != nil || session == nil {
		respondFailure(w, refuse("authorization_revoked", http.StatusUnauthorized))
		return
	}
	actorID, _ := session.Values["user_id"].(int)
	if actorID <= 1 {
		respondFailure(w, refuse("authorization_revoked", http.StatusUnauthorized))
		return
	}
	ip, _ := r.Context().Value(context_keys.ClientIPKey{}).(string)
	if ip == "" {
		ip, _, _ = net.SplitHostPort(r.RemoteAddr)
	}
	if err = reserveAuthenticationAttempt(r.Context(), backend.DbAdmin, actorID, ip); err != nil {
		respondFailure(w, err)
		return
	}
	tx, actor, err := beginAdmission(w, r, true)
	if err != nil {
		respondFailure(w, err)
		return
	}
	var request ReauthenticationRequest
	if err = decodeBody(w, r, &request); err != nil {
		respondFailure(w, err)
		return
	}
	binding, err := validateReauthenticationTarget(r.Context(), tx, request, time.Now())
	if err != nil {
		respondFailure(w, err)
		return
	}
	binding.AuthorizationContext = actor
	required, method, err := auth.CheckRecentCredentials(r.Context(), actor.ActorID, actor.Generation, request.Password, request.FactorCode)
	request.Password = ""
	request.FactorCode = ""
	if err != nil {
		code, status := "reauthentication_refused", http.StatusForbidden
		if errors.Is(err, auth.ErrRecentCredentialsRateLimited) {
			code, status = "rate_limited", http.StatusTooManyRequests
		}
		respondFailure(w, refuse(code, status))
		return
	}
	if required {
		httpresponse.RespondWithJSON(w, http.StatusOK, ReauthenticationResponse{ProtocolVersion: ProtocolVersion, FactorRequired: true, VerificationMethod: method})
		return
	}
	if err = RecheckAuthorization(r.Context(), tx, actor); err != nil {
		respondFailure(w, err)
		return
	}
	response, err := createProof(r.Context(), tx, binding, method, time.Now())
	if err != nil {
		respondFailure(w, err)
		return
	}
	response.VerificationMethod = method
	httpresponse.RespondWithJSON(w, http.StatusCreated, response)
}
