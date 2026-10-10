// update_capability_checker.go
// Owns the separately granted application-update permission and its write guard.
// Connects permission startup, admission and every policy metadata mutation.
// Prevents permissive route fallbacks and membership edits from self-granting updates.
package update_capability

import (
	"context"
	"database/sql"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/httpresponse"
	"net/http"
	"strings"
)

const Name = "capability.application_update"
const Route = "/capabilities/application-update"

// RequiresExplicitGrant includes the reserved capability and browser mutation routes.
func RequiresExplicitGrant(route string) bool {
	return route == Route || strings.HasPrefix(route, "/api/admin/application-update")
}

// Granted reads only a live tableless capability granted through current memberships.
func Granted(ctx context.Context, q *sql.Tx, actorID int) (bool, error) {
	var granted bool
	err := q.QueryRowContext(ctx, `SELECT EXISTS (
		SELECT 1 FROM public.system_functions f
		JOIN public.system_group_table_func_rights r ON r.function_id=f.id
		JOIN public.system_user_group_memberships m ON m.group_id=r.user_group_id
		WHERE f.name=$1 AND f.url_route_endpoint=$2 AND f.disabled IS FALSE
		AND f.specific_table_related IS FALSE AND r.target_table_uid IS NULL
		AND COALESCE(NULLIF(r.target_schema_name,''),'public')='public' AND m.user_id=$3
	)`, Name, Route, actorID).Scan(&granted)
	return granted, err
}

// WriteGuard records effective authorization before changes, including membership changes.
type WriteGuard struct {
	actorID int
	granted bool
}

// Capture snapshots the actor's effective right before any policy metadata write.
func Capture(ctx context.Context, tx *sql.Tx) (*WriteGuard, error) {
	actor, ok := dbutils.GetRequestActorContext(ctx)
	if !ok || actor.UserID <= 1 {
		return nil, nil
	} // operator migrations/imports have no browser actor
	granted, err := Granted(ctx, tx, actor.UserID)
	return &WriteGuard{actorID: actor.UserID, granted: granted}, err
}

// Check refuses the whole transaction when its actor gains their own update right.
func (guard *WriteGuard) Check(ctx context.Context, tx *sql.Tx) error {
	if guard == nil || guard.granted {
		return nil
	}
	granted, err := Granted(ctx, tx, guard.actorID)
	if err != nil {
		return err
	}
	if granted {
		return &httpresponse.Refusal{Status: http.StatusForbidden, LangKey: "error_application_update_self_grant", Message: "error_application_update_self_grant"}
	}
	return nil
}
