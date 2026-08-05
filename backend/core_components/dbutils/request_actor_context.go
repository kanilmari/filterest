// request_actor_context.go
// Carries authenticated request actor details into database transaction scope.
// Bridges HTTP session identity and tx-local PostgreSQL settings for future RLS enforcement.
// Exists so pilot read paths can open a request-scoped transaction with stable actor metadata.
package dbutils

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"strconv"

	e_sessions "easelect/backend/core_components/sessions"
)

type contextKeyRequestActor string

const requestActorKey contextKeyRequestActor = "request_actor"

// RequestActorContext stores the request identity needed by tx-scoped DB policy checks.
type RequestActorContext struct {
	UserID   int
	UserRole string
	IsAdmin  bool
}

// NewRequestActorContext normalizes the current request actor into a small stable struct.
func NewRequestActorContext(userID int, userRole string) RequestActorContext {
	if userRole == "" {
		if userID <= 1 {
			userRole = "guest"
		} else {
			userRole = "basic"
		}
	}
	if userID <= 0 {
		userID = 1
	}
	return RequestActorContext{
		UserID:   userID,
		UserRole: userRole,
		IsAdmin:  userRole == "admin",
	}
}

// RequestActorContextFromRequest reads session identity once so middleware can reuse it.
func RequestActorContextFromRequest(r *http.Request) RequestActorContext {
	if actor, ok := GetRequestActorContext(r.Context()); ok {
		return actor
	}

	userID, err := e_sessions.GetUserIDFromSession(r)
	if err != nil || userID <= 0 {
		userID = 1
	}
	userRole := ""
	session, err := e_sessions.GetOrCreateSession(nil, r)
	if err == nil {
		if role, ok := session.Values["user_role"].(string); ok && role != "" {
			userRole = role
		}
	}
	return NewRequestActorContext(userID, userRole)
}

// SetRequestActorContext stores actor details in the request context for downstream readers.
func SetRequestActorContext(ctx context.Context, actor RequestActorContext) context.Context {
	return context.WithValue(ctx, requestActorKey, actor)
}

// GetRequestActorContext returns tx-relevant actor details when middleware attached them earlier.
func GetRequestActorContext(ctx context.Context) (RequestActorContext, bool) {
	actor, ok := ctx.Value(requestActorKey).(RequestActorContext)
	return actor, ok
}

// ApplyRequestActorToTx exposes request actor details as tx-local PostgreSQL settings.
func ApplyRequestActorToTx(tx *sql.Tx, actor RequestActorContext) error {
	if tx == nil {
		return fmt.Errorf("nil transaction")
	}

	_, err := tx.Exec(
		`SELECT
			set_config('app.user_id', $1, true),
			set_config('app.user_role', $2, true),
			set_config('app.is_admin', $3, true)`,
		strconv.Itoa(actor.UserID),
		actor.UserRole,
		strconv.FormatBool(actor.IsAdmin),
	)
	if err != nil {
		return fmt.Errorf("set request actor tx config: %w", err)
	}
	return nil
}
