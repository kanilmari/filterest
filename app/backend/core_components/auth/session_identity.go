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
	"easelect/backend/core_components/sign_in_deadline"
	"easelect/backend/core_components/sign_in_revocation"

	"github.com/gorilla/sessions"
)

func setAuthenticatedSessionIdentity(session *sessions.Session, userID int, username string) error {
	if session == nil {
		return fmt.Errorf("session is nil")
	}

	authenticationGeneration, err := currentEnabledAuthenticationGeneration(context.Background(), userID)
	if err != nil {
		return fmt.Errorf("resolve authentication generation: %w", err)
	}
	return setAuthenticatedSessionIdentityAtGeneration(session, userID, username, authenticationGeneration)
}

// currentEnabledAuthenticationGeneration reads the cross-schema session revocation state
// through the confidential pool. Startup grants that role only the public user columns
// needed by this check, keeping login and recovery callers off the shared admin pool.
func currentEnabledAuthenticationGeneration(ctx context.Context, userID int) (int64, error) {
	return auth_generation.Current(ctx, backend.DbConfidential, userID)
}

func setAuthenticatedSessionIdentityAtGeneration(session *sessions.Session, userID int, username string, authenticationGeneration int64) error {
	if session == nil {
		return fmt.Errorf("session is nil")
	}
	allowed, err := backend.UserLoginAllowed(context.Background(), backend.Db, userID)
	if err != nil {
		return err
	}
	if !allowed {
		return backend.ErrLoginNotAllowed
	}
	userRole, err := backend.ResolveUserRole(userID)
	if err != nil {
		return err
	}

	// Everything that can fail is asked before anything is written. A session is
	// shared for the whole request -- the audit stage reads it after the handler
	// returns -- so a half-written identity left behind by a failure part way
	// through would be seen by whatever looked next. Nothing below this line can
	// fail, so the session either gains the whole identity or none of it.
	//
	// The last moment this sign-in may be used is decided here, once, from the
	// database's own clock, and never revised afterwards.
	signInID, err := sign_in_revocation.NewSignInID()
	if err != nil {
		return err
	}
	expiresAt, err := sign_in_deadline.Decide(context.Background(), backend.Db)
	if err != nil {
		return err
	}

	session.Values["authenticated"] = true
	session.Values["user_id"] = userID
	session.Values["username"] = username
	session.Values["user_role"] = userRole
	// This one sign-in gets its own identity, so signing out here can be refused
	// afterwards without touching the same person's other browsers. Both it and the
	// deadline are written every time rather than only when absent: signing in
	// again in a browser that still holds an old session reuses that session, and a
	// value left over from the previous sign-in would either cut this one short or
	// outlive it.
	session.Values[sign_in_revocation.SessionKey] = signInID
	session.Values[sign_in_deadline.SessionKey] = expiresAt
	if err = auth_generation.Set(session, authenticationGeneration); err != nil {
		return err
	}
	return nil
}
