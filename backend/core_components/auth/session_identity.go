// session_identity.go
// Applies authenticated identity fields to the Gorilla session after login.
// Bridges backend role resolution and the auth handlers' session writes.
// Exists so every login/bootstrap path persists the same session identity contract.
package auth

import (
	"context"
	"fmt"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/auth_generation"

	"github.com/gorilla/sessions"
)

func setAuthenticatedSessionIdentity(session *sessions.Session, userID int, username string) error {
	if session == nil {
		return fmt.Errorf("session is nil")
	}

	authenticationGeneration, err := auth_generation.Current(context.Background(), backend.DbConfidential, userID)
	if err != nil {
		return fmt.Errorf("resolve authentication generation: %w", err)
	}
	return setAuthenticatedSessionIdentityAtGeneration(session, userID, username, authenticationGeneration)
}

func setAuthenticatedSessionIdentityAtGeneration(session *sessions.Session, userID int, username string, authenticationGeneration int64) error {
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
	if err = auth_generation.Set(session, authenticationGeneration); err != nil {
		return err
	}
	return nil
}
