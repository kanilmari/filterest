// session_identity.go
// Applies authenticated identity fields to the Gorilla session after login.
// Bridges backend role resolution and the auth handlers' session writes.
// Exists so every login/bootstrap path persists the same session identity contract.
package auth

import (
	"fmt"

	backend "easelect/backend/core_components"

	"github.com/gorilla/sessions"
)

func setAuthenticatedSessionIdentity(session *sessions.Session, userID int, username string) error {
	if session == nil {
		return fmt.Errorf("session is nil")
	}

	userRole, err := backend.ResolveUserRole(userID)
	if err != nil {
		return err
	}

	session.Values["authenticated"] = true
	session.Values["user_id"] = userID
	session.Values["username"] = username
	session.Values["user_role"] = userRole
	return nil
}
