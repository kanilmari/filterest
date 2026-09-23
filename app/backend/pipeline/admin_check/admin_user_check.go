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
	"easelect/backend/core_components/session_expiry"
	e_sessions "easelect/backend/core_components/sessions"
)

// WithAdminUserCheck verifies the current session user can use admin-only routes.
// It bridges session identity, system_users.admin_access_allowed, and downstream
// admin handlers, seeding an admin request actor so the later transaction stage
// uses the intended role-specific pool.
//
// The two outcomes stay apart on purpose. An unusable session is an ended sign-in
// and goes through session_expiry.RespondSignInNoLongerValid, which takes the
// person to sign in. A readable, signed-in person without administrator access is
// an ordinary permission denial and keeps its plain refusal.
func WithAdminUserCheck(innerHandler http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		session, err := e_sessions.GetOrCreateSession(w, r)
		if err != nil {
			log.Printf("\033[31m[WithAdminUserCheck] session error: %v\033[0m", err)
			session_expiry.RespondSignInNoLongerValid(w, r, nil, "admin stage could not read the session")
			return
		}

		userIDVal, ok := session.Values["user_id"]
		if !ok {
			session_expiry.RespondSignInNoLongerValid(w, r, session, "no sign-in on an administrator route")
			return
		}

		userID, ok := userIDVal.(int)
		if !ok {
			session_expiry.RespondSignInNoLongerValid(w, r, session, "the session's user identity is unreadable")
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
