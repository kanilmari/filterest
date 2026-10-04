// csrf_token_handler.go
// Returns the current session CSRF token through a minimal public endpoint.
// Bridges frontend token-bootstrap requests and the session store without exposing broader session internals.
// Exists to let clients fetch a CSRF token before authenticated mutating requests.

package auth

import (
	"net/http"

	"easelect/backend/core_components/httpresponse"
	e_sessions "easelect/backend/core_components/sessions"

	"github.com/google/uuid"
)

// CSRFTokenHandler returns (and lazily creates) the current session CSRF token.
func CSRFTokenHandler(w http.ResponseWriter, r *http.Request) {

	session, err := e_sessions.GetOrCreateSession(w, r)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "session_error")
		return
	}

	csrfToken, _ := session.Values["csrf_token"].(string)
	if csrfToken == "" {
		csrfToken = uuid.NewString()
		session.Values["csrf_token"] = csrfToken
		if err := e_sessions.Save(w, r, session); err != nil {
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "session_save_error")
			return
		}
	}

	// A token is valid only for the session it was read from; a cached answer
	// would hand back a token for a session the browser no longer has.
	w.Header().Set("Cache-Control", "no-store")
	httpresponse.RespondWithJSON(w, http.StatusOK, map[string]string{
		"csrf_token": csrfToken,
	})
}
