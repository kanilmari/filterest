// device_id_check.go
// Pipeline stage that validates the device ID submitted with each request.
// Bridges the request headers and the session-stored device fingerprint.
// Exists to detect session hijacking by ensuring device IDs match the session.
package device_id_check

import (
	"log"
	"net/http"

	e_sessions "easelect/backend/core_components/sessions"
)

// WithDeviceIDCheck validates the request device cookie against the session value.
// It sits between authenticated pipeline routes and downstream handlers, letting
// guest requests pass while redirecting logged-in sessions with missing or
// mismatched device IDs back to login.
func WithDeviceIDCheck(originalHandler http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		session, err := e_sessions.GetOrCreateSession(w, r)
		if err != nil {
			log.Printf("[WithDeviceIDCheck] session get failed: %v", err)
			http.Redirect(w, r, "/login", http.StatusSeeOther)
			return
		}

		// Guest users (user_id ≤ 1) have no authenticated session to protect.
		// Device ID validation only serves to detect session hijacking for
		// logged-in users, so guests pass through unconditionally.
		userID, _ := session.Values["user_id"].(int)
		if userID <= 1 {
			originalHandler(w, r)
			return
		}

		// Haetaan session arvot
		sess_device_id, _ := session.Values["device_id"].(string)
		if sess_device_id == "" {
			log.Printf("[WithDeviceIDCheck] no device_id in session -> login")
			http.Redirect(w, r, "/login", http.StatusSeeOther)
			return
		}

		// Haetaan device_id-eväste
		cookie_device_id, err := r.Cookie("device_id")
		if err != nil || cookie_device_id.Value == "" {
			log.Printf("[WithDeviceIDCheck] no device_id cookie -> login")
			http.Redirect(w, r, "/login", http.StatusSeeOther)
			return
		}

		if cookie_device_id.Value != sess_device_id {
			log.Printf("[WithDeviceIDCheck] device_id differs from session -> login")
			http.Redirect(w, r, "/login", http.StatusSeeOther)
			return
		}

		// OK -> jatketaan varsinaiseen handleriin
		originalHandler(w, r)
	}
}
