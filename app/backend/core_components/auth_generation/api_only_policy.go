// api_only_policy.go
// Defines the protected API-only identity and signed-session channel contract.
// Bridges restricted credentials with login and always-enforced request policy.
// Exists so public profile renames and caller-supplied headers cannot grant UI access.
package auth_generation

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"strings"

	"github.com/gorilla/sessions"
)

const AutomationHeader = "X-Filterest-Automation"
const AutomationSessionKey = "automation_api_authenticated"

// APIAccessState is loaded by immutable ID, never by mutable public profile fields.
type APIAccessState struct {
	APIOnly    bool
	Generation int64
	Enabled    bool
}

func LoadAPIAccessState(ctx context.Context, db Querier, userID int) (APIAccessState, error) {
	var state APIAccessState
	if db == nil || userID <= 1 {
		return state, errors.New("API access policy unavailable")
	}
	if database, ok := db.(*sql.DB); ok && database == nil {
		return state, errors.New("API access policy unavailable")
	}
	err := db.QueryRowContext(ctx, `
        SELECT ur.api_only, ur.authentication_generation, COALESCE(u.enabled, FALSE)
        FROM system_users u
        JOIN restricted.users_restricted ur ON ur.id = u.id
        WHERE u.id = $1
    `, userID).Scan(&state.APIOnly, &state.Generation, &state.Enabled)
	return state, err
}

// AutomationAPIRequest only identifies a channel; it never authenticates a caller.
// Both the matched route and actual path must be API paths: the HTML catch-all
// must not be reachable merely by spelling an unknown URL with an /api/ prefix.
func AutomationAPIRequest(r *http.Request, registeredPattern string) bool {
	return r != nil && r.URL != nil &&
		strings.HasPrefix(registeredPattern, "/api/") &&
		strings.HasPrefix(r.URL.Path, "/api/") &&
		len(r.Header.Values(AutomationHeader)) == 1 &&
		r.Header.Get(AutomationHeader) == "1"
}

func (state APIAccessState) MatchesAutomationSession(session *sessions.Session) bool {
	generation, ok := SessionValue(session)
	if session == nil {
		return false
	}
	marked, _ := session.Values[AutomationSessionKey].(bool)
	authenticated, _ := session.Values["authenticated"].(bool)
	return state.APIOnly && state.Enabled && state.Generation > 0 &&
		ok && generation == state.Generation && marked && authenticated
}
