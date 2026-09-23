// ensure_logged_in.go
// Pipeline stage that enforces authentication for protected routes.
// Bridges the session store and downstream handlers, answering an ended sign-in through one shared responder.
// Exists to gate protected routes on login status, with guest-user fallback when login_to_browse is false.
package auth_check

import (
	"log"
	"net/http"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/auth_generation"
	"easelect/backend/core_components/httpresponse"
	"easelect/backend/core_components/middlewares"
	"easelect/backend/core_components/session_expiry"
	e_sessions "easelect/backend/core_components/sessions"
)

// EnsureLoggedIn enforces that protected pipeline routes have an authenticated session.
// It bridges session state, the login_to_browse runtime setting, and downstream
// handlers so anonymous users either become guests when browsing is public or
// are told, in one agreed shape, that they have to sign in.
//
// Every refusal here goes through session_expiry.RespondSignInNoLongerValid: a
// page navigation reaches the login page with its explanation, and a background
// request gets a machine-readable authentication failure rather than the login
// page's own HTML with a success status.
func EnsureLoggedIn(original_handler http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		session, err := e_sessions.GetOrCreateSession(w, r)
		if err != nil {
			log.Printf("\033[31m[EnsureLoggedIn] session lookup failed: %v\033[0m", err)
			session_expiry.RespondSignInNoLongerValid(w, r, nil, "the session could not be read")
			return
		}

		user_id_val, ok := session.Values["user_id"]
		if ok {
			if userID, isInteger := user_id_val.(int); isInteger && userID > 1 {
				generationMatches, generationErr := backend.AuthenticatedSessionMatches(r.Context(), backend.DbConfidential, session, userID)
				if generationErr != nil {
					log.Printf("\033[31m[EnsureLoggedIn] authentication state unavailable for user %d: %v\033[0m", userID, generationErr)
					httpresponse.RespondWithError(w, http.StatusServiceUnavailable, "authentication state unavailable")
					return
				}
				if !generationMatches {
					auth_generation.ClearIdentity(session)
					if saveErr := session.Save(r, w); saveErr != nil {
						log.Printf("\033[31m[EnsureLoggedIn] stale session clear failed: %v\033[0m", saveErr)
						httpresponse.RespondWithError(w, http.StatusInternalServerError, "session save failed")
						return
					}
					user_id_val = nil
					ok = false
				}
			}
		}
		if !ok {
			// No user_id in session — check if guests are allowed to browse
			loginToBrowse, ltbErr := middlewares.CheckLoginToBrowse()
			if ltbErr != nil {
				log.Printf("\033[31m[EnsureLoggedIn] login_to_browse fetch failed: %v\033[0m", ltbErr)
				loginToBrowse = true // fail-safe: require login
			}

			if loginToBrowse {
				session_expiry.RespondSignInNoLongerValid(w, r, session, "no sign-in on a site that requires one")
				return
			}

			// login_to_browse=false → create guest session (user_id=1).
			// This mirrors the access-control guest fallback and avoids a cookie/session race
			// where concurrent auth bootstrap requests can observe a missing user_id.
			session.Values["user_id"] = 1
			if saveErr := session.Save(r, w); saveErr != nil {
				log.Printf("\033[31m[EnsureLoggedIn] guest session save failed: %v\033[0m", saveErr)
			}
			log.Printf("[EnsureLoggedIn] login_to_browse=false → guest session (user_id=1)")
			original_handler(w, r)
			return
		}

		userID, ok2 := user_id_val.(int)
		if !ok2 {
			session_expiry.RespondSignInNoLongerValid(w, r, session, "the session's user identity is unreadable")
			return
		}

		if userID == 1 {
			loginToBrowse, ltbErr := middlewares.CheckLoginToBrowse()
			if ltbErr != nil {
				log.Printf("\033[31m[EnsureLoggedIn] login_to_browse fetch failed: %v\033[0m", ltbErr)
				loginToBrowse = true
			}
			if loginToBrowse {
				session_expiry.RespondSignInNoLongerValid(w, r, session, "guest browsing is not allowed on this site")
				return
			}
		}

		original_handler(w, r)
	}
}
