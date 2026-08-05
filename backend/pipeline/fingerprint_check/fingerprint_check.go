// fingerprint_check.go
// Pipeline stage that validates the browser fingerprint stored in the session.
// Bridges the request fingerprint header and the session-stored fingerprint value.
// Exists to detect fingerprint mismatches that may indicate session theft.
package fingerprint_check

import (
	"log"
	"net/http"

	e_sessions "easelect/backend/core_components/sessions"
)

// WithFingerprintCheck validates the request fingerprint cookie against session state.
// It sits between authenticated pipeline routes and downstream handlers, letting
// guest requests pass while redirecting logged-in sessions with missing or
// mismatched fingerprints back to login.
func WithFingerprintCheck(originalHandler http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		session, err := e_sessions.GetOrCreateSession(w, r)
		if err != nil {
			log.Printf("\033[31merror: session get failed: %s\033[0m\n", err.Error())
			http.Redirect(w, r, "/login", http.StatusSeeOther)
			return
		}

		// Guest users (user_id ≤ 1) have no authenticated session to protect.
		// Fingerprint validation only serves to detect session hijacking for
		// logged-in users, so guests pass through unconditionally.
		userID, _ := session.Values["user_id"].(int)
		if userID <= 1 {
			originalHandler(w, r)
			return
		}

		sessFingerprint, _ := session.Values["fingerprint_hash"].(string)

		// The fingerprint cookie is HttpOnly and contains the HMAC-signed value.
		// X-Fingerprint header is no longer accepted — removing that attack surface.
		cookieFingerprint, cookieErr := r.Cookie("fingerprint")
		if cookieErr != nil || cookieFingerprint.Value == "" {
			if sessFingerprint == "" {
				log.Printf("[WithFingerprintCheck] no fingerprint value in session or cookie")
				http.Redirect(w, r, "/login", http.StatusSeeOther)
				return
			}
			// Session has a fingerprint but cookie is absent (e.g. cookie expired mid-session).
			// Redirect to login so the user re-authenticates and a fresh cookie is issued.
			log.Printf("[WithFingerprintCheck] fingerprint cookie missing, redirecting to login")
			http.Redirect(w, r, "/login", http.StatusSeeOther)
			return
		}

		// Both values are HMAC-signed by the server — a simple equality check is sufficient.
		if sessFingerprint != cookieFingerprint.Value {
			log.Printf("[WithFingerprintCheck] fingerprint mismatch: session vs cookie -> logging out")
			http.Redirect(w, r, "/login", http.StatusSeeOther)
			return
		}

		// OK -> jatketaan
		originalHandler(w, r)
	}
}
