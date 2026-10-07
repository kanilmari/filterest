// auth_generation.go
// Validates the per-user authentication generation stored in signed sessions.
// Bridges restricted credential changes with stateless browser-session invalidation.
// Exists so one user's old sessions can be revoked without rotating site-wide cookie keys.
package auth_generation

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"easelect/backend/core_components/sign_in_deadline"
	"easelect/backend/core_components/sign_in_revocation"

	"github.com/gorilla/sessions"
)

const SessionKey = "authentication_generation"

// Querier is the narrow database capability needed to read one user's generation.
type Querier interface {
	QueryRowContext(context.Context, string, ...interface{}) *sql.Row
}

// Current returns the generation only for an enabled user with restricted credentials.
func Current(ctx context.Context, db Querier, userID int) (int64, error) {
	state, err := currentState(ctx, db, userID)
	return state.generation, err
}

type generationState struct {
	generation         int64
	survivingSignInID  sql.NullString
	survivorGeneration sql.NullInt64
}

// Read the generation and its survivor together: separate reads could mix two bumps.
func currentState(ctx context.Context, db Querier, userID int) (generationState, error) {
	var state generationState
	if db == nil {
		return state, errors.New("authentication generation database unavailable")
	}
	if database, ok := db.(*sql.DB); ok && database == nil {
		return state, errors.New("authentication generation database unavailable")
	}
	if userID <= 1 {
		return state, fmt.Errorf("authentication generation is not defined for user %d", userID)
	}

	err := db.QueryRowContext(ctx, `
		SELECT ur.authentication_generation, ur.surviving_sign_in_id, ur.surviving_sign_in_generation
		FROM system_users u
		JOIN restricted.users_restricted ur ON ur.id = u.id
		WHERE u.id = $1
		  AND u.enabled IS TRUE
	`, userID).Scan(&state.generation, &state.survivingSignInID, &state.survivorGeneration)
	if err != nil {
		return generationState{}, err
	}
	if state.generation < 1 {
		return generationState{}, errors.New("invalid authentication generation")
	}
	return state, nil
}

// SessionValue reads the generation from a decoded Gorilla session.
func SessionValue(session *sessions.Session) (int64, bool) {
	if session == nil {
		return 0, false
	}
	switch value := session.Values[SessionKey].(type) {
	case int64:
		return value, value > 0
	case int:
		return int64(value), value > 0
	default:
		return 0, false
	}
}

// Matches reports whether the signed session still matches the enabled database identity.
// Missing generations intentionally invalidate sessions created before this contract existed.
// Only the sign-in kept by the latest bump may recover an older cookie written by
// an in-flight request. The shared access boundary still checks revocation and expiry.
func Matches(ctx context.Context, db Querier, session *sessions.Session, userID int) (bool, error) {
	stored, ok := SessionValue(session)
	if !ok {
		return false, nil
	}
	signInID, identified := sign_in_revocation.SessionValue(session)
	if !identified {
		return false, nil
	}
	current, err := currentState(ctx, db, userID)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if stored == current.generation {
		return true, nil
	}
	if stored < current.generation && current.survivingSignInID.Valid &&
		current.survivingSignInID.String == signInID && current.survivorGeneration.Valid &&
		current.survivorGeneration.Int64 == current.generation {
		// The device stage saves this re-stamped session through normal renewal.
		if err := Set(session, current.generation); err != nil {
			return false, err
		}
		return true, nil
	}
	return false, nil
}

// Set records the generation in a session after credentials have been verified.
func Set(session *sessions.Session, generation int64) error {
	if session == nil || generation < 1 {
		return errors.New("invalid authentication generation session state")
	}
	session.Values[SessionKey] = generation
	return nil
}

// ClearIdentity removes every authenticated identity value controlled by this contract.
func ClearIdentity(session *sessions.Session) {
	if session == nil {
		return
	}
	for _, key := range []string{
		"authenticated",
		"user_id",
		"username",
		"user_role",
		SessionKey,
		// The sign-in's own identity goes with the identity it belongs to. A
		// session left holding it after being emptied would carry the name of a
		// sign-in it no longer is. The key is named by its owning package so the
		// application keeps one spelling of it.
		sign_in_revocation.SessionKey,
		// The deadline goes with the sign-in it belongs to, for the same reason:
		// a session left holding it after being emptied would carry the last
		// moment of a sign-in it no longer is.
		sign_in_deadline.SessionKey,
		AutomationSessionKey,
	} {
		delete(session.Values, key)
	}
}
