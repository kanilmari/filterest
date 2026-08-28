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

	"github.com/gorilla/sessions"
)

const SessionKey = "authentication_generation"

// Querier is the narrow database capability needed to read one user's generation.
type Querier interface {
	QueryRowContext(context.Context, string, ...interface{}) *sql.Row
}

// Current returns the generation only for an enabled user with restricted credentials.
func Current(ctx context.Context, db Querier, userID int) (int64, error) {
	if db == nil {
		return 0, errors.New("authentication generation database unavailable")
	}
	if database, ok := db.(*sql.DB); ok && database == nil {
		return 0, errors.New("authentication generation database unavailable")
	}
	if userID <= 1 {
		return 0, fmt.Errorf("authentication generation is not defined for user %d", userID)
	}

	var generation int64
	err := db.QueryRowContext(ctx, `
		SELECT ur.authentication_generation
		FROM system_users u
		JOIN restricted.users_restricted ur ON ur.id = u.id
		WHERE u.id = $1
		  AND u.enabled IS TRUE
	`, userID).Scan(&generation)
	if err != nil {
		return 0, err
	}
	if generation < 1 {
		return 0, errors.New("invalid authentication generation")
	}
	return generation, nil
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
func Matches(ctx context.Context, db Querier, session *sessions.Session, userID int) (bool, error) {
	stored, ok := SessionValue(session)
	if !ok {
		return false, nil
	}
	current, err := Current(ctx, db, userID)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return stored == current, nil
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
	} {
		delete(session.Values, key)
	}
}
