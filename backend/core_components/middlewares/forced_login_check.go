// forced_login_check.go
// Middleware that redirects unauthenticated users when forced-login is active.
// Bridges the system_config forced-login flag and the login redirect flow.
// Exists to enforce site-wide authentication regardless of the requested route.
package middlewares

import (
	"log"
	"net/http"

	e_sessions "easelect/backend/core_components/sessions"
)

// WithForcedLoginCheck redirects to /login if login_to_browse is true and user is not logged in.
func WithForcedLoginCheck(originalHandler http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		loginToBrowse, err := CheckLoginToBrowse()
		if err != nil {
			log.Printf("\033[31merror: %s\033[0m\n", err.Error())
			loginToBrowse = true
		}

		if loginToBrowse {
			session, errSession := e_sessions.GetOrCreateSession(w, r)
			if errSession != nil {
				log.Printf("\033[31m[WithForcedLoginCheck] session lookup failed: %s\033[0m\n", errSession.Error())
				http.Redirect(w, r, "/login", http.StatusSeeOther)
				return
			}

			userIDVal, ok := session.Values["user_id"]
			if !ok {
				log.Println("[WithForcedLoginCheck] user_id missing, redirecting to login")
				http.Redirect(w, r, "/login", http.StatusSeeOther)
				return
			}
			var userID int
			switch v := userIDVal.(type) {
			case int:
				userID = v
			case int64:
				userID = int(v)
			case float64:
				userID = int(v)
			default:
				log.Println("[WithForcedLoginCheck] user_id wrong type, redirecting to login")
				http.Redirect(w, r, "/login", http.StatusSeeOther)
				return
			}
			if userID < 1 {
				log.Println("[WithForcedLoginCheck] invalid user_id, redirecting to login")
				http.Redirect(w, r, "/login", http.StatusSeeOther)
				return
			}
		}

		originalHandler(w, r)
	}
}
