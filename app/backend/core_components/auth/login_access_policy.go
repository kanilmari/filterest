// login_access_policy.go
// Applies the shared sign-in admission policy to JSON, legacy, and pending-factor attempts.
// Bridges current user eligibility with auth responses and pending session state.
// Prevents disallowed accounts from receiving challenges or completing a previously started login.
package auth

import (
	backend "easelect/backend/core_components"
	"github.com/gorilla/sessions"
	"net/http"
)

// enforceLoginAccess checks live policy before challenge or authenticated-session side effects.
// A failed policy read fails closed; only pending sign-in state is cleared, leaving public
// guest browsing and unrelated already-authorized session data under their existing handlers.
func enforceLoginAccess(w http.ResponseWriter, r *http.Request, session *sessions.Session, userID int) bool {
	allowed, err := backend.UserLoginAllowed(r.Context(), backend.Db, userID)
	if err == nil && allowed {
		return true
	}
	clearPendingLoginState(session)
	if saveErr := saveSession(w, r, session); saveErr != nil {
		respondJSON(w, http.StatusInternalServerError, map[string]interface{}{"error": "session_error"})
		return false
	}
	if err != nil {
		respondJSON(w, http.StatusServiceUnavailable, map[string]interface{}{"error": "authentication_policy_unavailable"})
	} else {
		respondJSON(w, http.StatusForbidden, map[string]interface{}{"error": "login_not_allowed"})
	}
	return false
}
