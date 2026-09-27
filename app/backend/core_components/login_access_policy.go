// login_access_policy.go
// Reads independent sign-in visibility and administrator-only admission settings.
// Bridges validated system_config values, canonical administrator identity, and signed sessions.
// Keeps public browsing independent while enforcing the same login policy at every auth boundary.
package backend

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"easelect/backend/core_components/auth_generation"
	"easelect/backend/core_components/sign_in_deadline"
	"easelect/backend/core_components/sign_in_revocation"
	"github.com/gorilla/sessions"
)

var ErrLoginNotAllowed = errors.New("login_not_allowed")

// LoginAccessSettings carries presentation and admission policy without merging their meanings.
type LoginAccessSettings struct {
	ShowLoginButton   bool
	OnlyAdminCanLogin bool
}

// readLoginBoolean applies a compatible default only to a missing key.
// Between runtime configuration and auth boundaries, malformed values and database failures
// remain errors so a configured admission restriction cannot silently disappear.
func readLoginBoolean(ctx context.Context, db *sql.DB, key string, fallback bool) (bool, error) {
	if db == nil {
		return false, errors.New("login policy database unavailable")
	}
	var value sql.NullBool
	err := db.QueryRowContext(ctx, "SELECT boolean_value FROM system_config WHERE key = $1", key).Scan(&value)
	if errors.Is(err, sql.ErrNoRows) {
		return fallback, nil
	}
	if err != nil {
		return false, err
	}
	if !value.Valid {
		return false, fmt.Errorf("login policy %s must be boolean", key)
	}
	return value.Bool, nil
}

// ReadShowLoginButton reads presentation policy only; direct login routes remain reachable.
func ReadShowLoginButton(ctx context.Context, db *sql.DB) (bool, error) {
	return readLoginBoolean(ctx, db, "show_login_button", true)
}

// ReadOnlyAdminCanLogin reads sign-in admission policy, defaulting existing sites to unrestricted.
func ReadOnlyAdminCanLogin(ctx context.Context, db *sql.DB) (bool, error) {
	return readLoginBoolean(ctx, db, "only_admin_can_login", false)
}

// ReadLoginAccessSettings exposes both independent settings to the public auth bootstrap.
func ReadLoginAccessSettings(ctx context.Context, db *sql.DB) (LoginAccessSettings, error) {
	show, err := ReadShowLoginButton(ctx, db)
	if err != nil {
		return LoginAccessSettings{}, err
	}
	onlyAdmin, err := ReadOnlyAdminCanLogin(ctx, db)
	if err != nil {
		return LoginAccessSettings{}, err
	}
	return LoginAccessSettings{ShowLoginButton: show, OnlyAdminCanLogin: onlyAdmin}, nil
}

// UserLoginAllowed verifies current admission after credentials and again before session creation.
// Between current configuration and persisted identity, administrator-only mode requires an
// enabled account, canonical admin-group role, and the independent per-user admin-access flag.
func UserLoginAllowed(ctx context.Context, db *sql.DB, userID int) (bool, error) {
	onlyAdmin, err := ReadOnlyAdminCanLogin(ctx, db)
	if err != nil {
		return false, err
	}
	if userID <= 1 {
		return false, nil
	}
	if !onlyAdmin {
		return true, nil
	}
	var enabled, adminAllowed bool
	err = db.QueryRowContext(ctx, `SELECT enabled IS TRUE, admin_access_allowed IS TRUE
        FROM system_users WHERE id = $1`, userID).Scan(&enabled, &adminAllowed)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if !enabled || !adminAllowed {
		return false, nil
	}
	role, err := ResolveUserRole(userID)
	if err != nil {
		return false, err
	}
	return role == "admin", nil
}

// AuthenticatedSessionMatches preserves credential-generation validation and adds current admission.
// Every existing signed-session boundary uses this wrapper so enabling administrator-only login
// also ends a non-admin's authenticated identity on their next request without disabling guests.
//
// Because every such boundary is already here — the pipeline's authentication stage, the public
// root page, the storage route, the authentication-modes bootstrap, registration and the dataset
// sort defaults — this is also where a sign-in that has been signed out, or that has reached the
// last moment it was given, is refused: once, rather than in each of them. Its callers all answer
// a false the same way: they empty the authenticated identity out of the session and go on as a
// visitor, or send the person to sign in again.
func AuthenticatedSessionMatches(ctx context.Context, credentialDB auth_generation.Querier, session *sessions.Session, userID int) (bool, error) {
	// A guest was never signed in. It carries no sign-in identity and no deadline,
	// and asking it for either would refuse every visitor on a site that lets
	// people browse. The callers already separate the two, and this keeps that
	// separation true here as well.
	if userID <= 1 {
		return UserLoginAllowed(ctx, Db, userID)
	}

	signInID, identified := sign_in_revocation.SessionValue(session)
	expiresAt, dated := sign_in_deadline.SessionValue(session)

	// A sign-in needs both to be held to anything. Without an identity nothing
	// names it, so a sign-out has nothing to record and nothing here can compare;
	// without a deadline there is no last moment to enforce. Only sign-ins made
	// before these existed are in that state, and they do not fade away by
	// themselves -- a used sign-in is renewed, so one visited daily would carry on
	// indefinitely. They are refused once and the person signs in again.
	//
	// Neither is ever filled in after the fact. Deriving a deadline now, from a
	// cookie that may have been re-signed any number of times, would be exactly the
	// extension the deadline exists to prevent.
	if !identified || !dated {
		return false, nil
	}

	// Signed out and out of time are asked together, and first. They are one
	// indexed lookup and a comparison against the same reading of the database's
	// clock, against two reads of user and configuration rows below -- and asking
	// them first means a sign-in that is already finished never causes a restricted
	// credential row to be read at all.
	usable, err := sign_in_revocation.StillUsable(ctx, Db, signInID, expiresAt)
	if err != nil {
		return false, err
	}
	if !usable {
		return false, nil
	}
	matches, err := auth_generation.Matches(ctx, credentialDB, session, userID)
	if err != nil || !matches {
		return matches, err
	}
	return UserLoginAllowed(ctx, Db, userID)
}
