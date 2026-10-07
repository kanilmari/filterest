// account_editor_guard.go
// Refuses generic writes to account datasets by anyone except a current trusted administrator.
// Bridges editor entry points with the authoritative account flag and canonical group membership.
// Exists because route rights alone must never expose an account-name comparison oracle.
package accountwrite

import (
	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/httpresponse"
	sessions "easelect/backend/core_components/sessions"
	"net/http"
)

const administratorAccountSQL = `SELECT COALESCE(admin_access_allowed,false) AND enabled IS TRUE AND EXISTS (SELECT 1 FROM system_user_group_memberships WHERE user_id=$1 AND group_id=1) FROM system_users WHERE id=$1`

func IsAccountDataset(table string) bool {
	switch table {
	case "system_users", "system_user_groups", "system_user_group_memberships", "system_group_table_func_rights", "system_functions":
		return true
	}
	return false
}

// RequireAdministrator checks before any payload, row, name or write is examined.
func RequireAdministrator(w http.ResponseWriter, r *http.Request, table string) error {
	if !IsAccountDataset(table) {
		return nil
	}
	// The authentication/access middleware attaches an authoritative administrator
	// actor before trusted internal handlers run. Recheck the public flag and
	// membership too: a cookie or a stale actor role alone is never enough.
	if actor, ok := dbutils.GetRequestActorContext(r.Context()); ok && actor.UserID > 1 && actor.IsAdmin && actor.UserRole == "admin" {
		if backend.Db != nil {
			var allowed bool
			err := backend.Db.QueryRowContext(r.Context(), administratorAccountSQL, actor.UserID).Scan(&allowed)
			if err == nil && allowed {
				return nil
			}
		}
	}
	refusal := &httpresponse.Refusal{Status: http.StatusForbidden, LangKey: "error_identity_edit_requires_administrator", Message: "error_identity_edit_requires_administrator"}
	if sessions.Store == nil {
		refusal.Status = http.StatusUnauthorized
	} else {
		session, err := sessions.Load(r)
		id, ok := 0, false
		if session != nil {
			id, ok = session.Values["user_id"].(int)
		}
		if err != nil || session == nil || !ok || id <= 1 || session.Values["authenticated"] != true {
			refusal.Status = http.StatusUnauthorized
		} else if backend.Db != nil && backend.DbConfidential != nil {
			current, err := backend.AuthenticatedSessionMatches(r.Context(), backend.DbConfidential, session, id)
			if err == nil && current {
				var allowed bool
				err = backend.Db.QueryRowContext(r.Context(), administratorAccountSQL, id).Scan(&allowed)
				if err == nil && allowed {
					return nil
				}
			}
		}
	}
	httpresponse.RespondWithRefusal(w, refusal)
	return refusal
}
