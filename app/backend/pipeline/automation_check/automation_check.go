// automation_check.go
// Restricts protected automation identities to authenticated API-channel sessions.
// Runs even for public route profiles, before auth can downgrade an invalid cookie.
// Exists to reject legacy/browser sessions while preserving ordinary route and table ACLs.
package automation_check

import (
	"database/sql"
	"errors"
	"net/http"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/auth_generation"
	"easelect/backend/core_components/httpresponse"
	e_sessions "easelect/backend/core_components/sessions"
)

// WithAutomationCheck never creates a session for anonymous bootstrap requests.
func WithAutomationCheck(registeredPattern string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if _, err := r.Cookie(e_sessions.SessionName); err != nil || e_sessions.Store == nil {
			next(w, r)
			return
		}
		session, err := e_sessions.Store.Get(r, e_sessions.SessionName)
		if err != nil {
			// Existing auth handles invalid signatures; there is no trusted identity.
			next(w, r)
			return
		}
		userID, ok := session.Values["user_id"].(int)
		if !ok || userID <= 1 {
			next(w, r)
			return
		}
		state, err := auth_generation.LoadAPIAccessState(r.Context(), backend.DbConfidential, userID)
		if errors.Is(err, sql.ErrNoRows) {
			auth_generation.ClearIdentity(session)
			_ = session.Save(r, w)
			httpresponse.RespondWithError(w, http.StatusUnauthorized, "authentication_expired")
			return
		}
		if err != nil {
			httpresponse.RespondWithError(w, http.StatusServiceUnavailable, "authentication_policy_unavailable")
			return
		}
		if !state.APIOnly {
			next(w, r)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		if !state.MatchesAutomationSession(session) {
			auth_generation.ClearIdentity(session)
			_ = session.Save(r, w)
			httpresponse.RespondWithError(w, http.StatusUnauthorized, "automation_session_expired")
			return
		}
		if !auth_generation.AutomationAPIRequest(r, registeredPattern) {
			httpresponse.RespondWithError(w, http.StatusForbidden, "automation_api_channel_required")
			return
		}
		next(w, r)
	}
}
