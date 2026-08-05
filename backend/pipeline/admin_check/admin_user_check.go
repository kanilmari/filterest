// admin_user_check.go
// Pipeline stage that verifies whether the current user has admin privileges.
// Bridges the user session and admin-only route handlers.
// Exists to reject requests to admin-only routes from non-admin users.
package admin_check

import (
	"log"
	"net/http"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/httpresponse"
	e_sessions "easelect/backend/core_components/sessions"
)

// WithAdminUserCheck verifies the current session user can use admin-only routes.
// It bridges session identity, system_users.admin_access_allowed, and downstream
// admin handlers, seeding an admin request actor so the later transaction stage
// uses the intended role-specific pool.
func WithAdminUserCheck(innerHandler http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		session, err := e_sessions.GetOrCreateSession(w, r)
		if err != nil {
			log.Printf("\033[31m[WithAdminUserCheck] session error: %v\033[0m", err)
			httpresponse.RespondWithAuthFailure(w, "403 - Forbidden")
			return
		}

		userIDVal, ok := session.Values["user_id"]
		if !ok {
			log.Printf("\033[31m[WithAdminUserCheck] no user_id in session\033[0m")
			http.Redirect(w, r, "/login", http.StatusSeeOther)
			return
		}

		userID, ok := userIDVal.(int)
		if !ok {
			log.Printf("\033[31m[WithAdminUserCheck] user_id is not int\033[0m")
			httpresponse.RespondWithAuthFailure(w, "403 - Forbidden")
			return
		}

		var adminAllowed bool
		err = backend.Db.QueryRow(
			`SELECT COALESCE(admin_access_allowed, false) FROM system_users WHERE id = $1`,
			userID,
		).Scan(&adminAllowed)
		if err != nil {
			log.Printf("\033[31m[WithAdminUserCheck] DB error checking admin_access_allowed for user %d: %v\033[0m", userID, err)
			httpresponse.RespondWithError(w, http.StatusForbidden, "403 - Forbidden")
			return
		}

		if !adminAllowed {
			log.Printf("\033[31m[WithAdminUserCheck] user %d blocked: admin_access_allowed = false\033[0m", userID)
			httpresponse.RespondWithError(w, http.StatusForbidden, "403 - Forbidden (admin access not allowed)")
			return
		}

		actorRole, roleErr := backend.ResolveUserRole(userID)
		if roleErr != nil {
			log.Printf("\033[33m[WithAdminUserCheck] role resolution failed for user %d, using request-scoped admin fallback: %v\033[0m", userID, roleErr)
			actorRole = "admin"
		} else if actorRole != "admin" {
			log.Printf("\033[33m[WithAdminUserCheck] user %d passed admin gate with non-admin session role %q, using request-scoped admin role\033[0m", userID, actorRole)
			actorRole = "admin"
		}

		actor := dbutils.NewRequestActorContext(userID, actorRole)
		innerHandler(w, r.WithContext(dbutils.SetRequestActorContext(r.Context(), actor)))
	}
}
