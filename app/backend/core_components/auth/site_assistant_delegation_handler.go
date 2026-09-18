// site_assistant_delegation_handler.go
// Exchanges one assistant job's one-time code for a short-lived session of the asking administrator.
// Bridges the in-process delegation store and the ordinary authenticated session contract.
// Exists so an assistant runner needs no stored password and inherits the asker's own rights.
package auth

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	e_sessions "easelect/backend/core_components/sessions"
	"easelect/backend/core_components/site_assistant"

	"github.com/google/uuid"
	"github.com/gorilla/sessions"
)

// siteAssistantExchangeBodyLimit keeps the unauthenticated exchange body tiny.
const siteAssistantExchangeBodyLimit = 512

type siteAssistantExchangeRequest struct {
	Code string `json:"code"`
}

// siteAssistantDelegationStore and siteAssistantIdentitySetter are replaced in tests.
var siteAssistantDelegationStore = site_assistant.DefaultStore
var siteAssistantIdentitySetter = setAuthenticatedSessionIdentity

// SiteAssistantDelegationExchangeHandler turns a job's one-time code into a
// session that acts as the administrator who asked for the job. The session
// expires with the delegation, reads with that administrator's own rights and
// may write only calls the administrator has approved.
func SiteAssistantDelegationExchangeHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if r.Method != http.MethodPost {
		respondJSON(w, http.StatusMethodNotAllowed, map[string]interface{}{"error": "method_not_allowed"})
		return
	}

	body, err := io.ReadAll(io.LimitReader(r.Body, siteAssistantExchangeBodyLimit+1))
	if err != nil || len(body) > siteAssistantExchangeBodyLimit {
		respondJSON(w, http.StatusBadRequest, map[string]interface{}{"error": "invalid_request"})
		return
	}
	var request siteAssistantExchangeRequest
	if err := json.Unmarshal(body, &request); err != nil || strings.TrimSpace(request.Code) == "" {
		respondJSON(w, http.StatusBadRequest, map[string]interface{}{"error": "invalid_request"})
		return
	}

	delegation, err := siteAssistantDelegationStore.Exchange(strings.TrimSpace(request.Code))
	if err != nil {
		respondJSON(w, http.StatusUnauthorized, map[string]interface{}{"error": "delegation_not_valid"})
		return
	}

	session, err := e_sessions.GetOrCreateSession(w, r)
	if err != nil {
		siteAssistantDelegationStore.Revoke(delegation.ID)
		respondJSON(w, http.StatusInternalServerError, map[string]interface{}{"error": "session_error"})
		return
	}
	remaining := int(time.Until(delegation.ExpiresAt).Seconds())
	if remaining <= 0 {
		siteAssistantDelegationStore.Revoke(delegation.ID)
		respondJSON(w, http.StatusUnauthorized, map[string]interface{}{"error": "delegation_not_valid"})
		return
	}
	session.Options = &sessions.Options{
		Path:     "/",
		MaxAge:   remaining,
		HttpOnly: true,
		Secure:   e_sessions.ShouldUseSecureCookies(),
		SameSite: http.SameSiteLaxMode,
	}

	if err := siteAssistantIdentitySetter(session, delegation.UserID, delegation.Username); err != nil {
		siteAssistantDelegationStore.Revoke(delegation.ID)
		log.Printf("\033[31m[site-assistant-exchange] identity setup failed for user %d: %v\033[0m", delegation.UserID, err)
		respondJSON(w, http.StatusForbidden, map[string]interface{}{"error": "delegation_not_valid"})
		return
	}

	// A runner has no browser, so the session gets its own device and fingerprint
	// values instead of reusing the administrator's browser identity.
	deviceID := uuid.NewString()
	fingerprint := HMACFingerprint(uuid.NewString())
	session.Values["device_id"] = deviceID
	session.Values["fingerprint_hash"] = fingerprint
	session.Values[site_assistant.SessionDelegationKey] = delegation.ID
	e_sessions.SetDeviceIDCookie(w, deviceID)
	e_sessions.SetFingerprintCookie(w, fingerprint)

	if err := saveSession(w, r, session); err != nil {
		siteAssistantDelegationStore.Revoke(delegation.ID)
		respondJSON(w, http.StatusInternalServerError, map[string]interface{}{"error": "session_error"})
		return
	}

	log.Printf("[site-assistant-exchange] job %s acts as '%s' (id=%d) until %s",
		delegation.JobID, delegation.Username, delegation.UserID, delegation.ExpiresAt.UTC().Format(time.RFC3339))
	respondJSON(w, http.StatusOK, map[string]interface{}{
		"authenticated":     true,
		"delegation_id":     delegation.ID,
		"job_id":            delegation.JobID,
		"username":          delegation.Username,
		"expires_at":        delegation.ExpiresAt.UTC().Format(time.RFC3339),
		"write_calls_need":  "approval",
		"api_catalog_route": "/api/admin/site-assistant/api-catalog",
	})
}
