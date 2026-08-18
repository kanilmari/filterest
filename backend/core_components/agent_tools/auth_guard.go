// auth_guard.go
// Enforces authenticated, non-guest access for private agent-tool endpoints.
// Bridges Gorilla session identity and the agent-tools HTTP handlers.
// Exists because LoginOnlyProfile can allow guest browsing when login_to_browse=false.
package agent_tools

import (
	"net/http"

	"easelect/backend/core_components/httpresponse"
	e_sessions "easelect/backend/core_components/sessions"
)

// requireAuthenticatedAgentToolUser verifies that an agent-tool request belongs to a real logged-in user.
// It sits inside the private tool handlers so guest browsing cannot expose task or inter-agent data.
func requireAuthenticatedAgentToolUser(w http.ResponseWriter, r *http.Request) bool {
	session, err := e_sessions.GetOrCreateSession(w, r)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusUnauthorized, "not_authenticated")
		return false
	}

	userID, ok := session.Values["user_id"].(int)
	authenticated, authOK := session.Values["authenticated"].(bool)
	if !ok || userID <= 1 || !authOK || !authenticated {
		httpresponse.RespondWithError(w, http.StatusUnauthorized, "not_authenticated")
		return false
	}

	return true
}
