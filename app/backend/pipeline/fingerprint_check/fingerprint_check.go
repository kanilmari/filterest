// fingerprint_check.go
// Pipeline stage that validates the browser fingerprint stored in the session.
// Bridges the request fingerprint cookie and the session-stored fingerprint value.
// Exists to detect fingerprint mismatches that may indicate session theft.
package fingerprint_check

import (
	"net/http"

	"easelect/backend/core_components/session_expiry"
	e_sessions "easelect/backend/core_components/sessions"
)

// WithFingerprintCheck validates the request fingerprint cookie against session state.
// It sits between authenticated pipeline routes and downstream handlers, letting
// guest requests pass while treating a logged-in session with a missing or
// mismatched fingerprint as a sign-in the server can no longer accept.
//
// A session cookie lives seven days and its seven days restart every time a
// request writes the session. The fingerprint cookie used to be written only at
// sign-in, so a person who kept using the site reached a day where the session
// was still readable and the binding had already expired underneath it, and was
// signed out although they had never been away. This stage therefore renews the
// binding on the same terms the session renews itself: a request that proves the
// binding is still the right one re-issues it for a full seven days.
//
// Renewing is not accepting. The value written back is the one the session
// itself holds, and it is written only after the request's own cookie has been
// compared with it. A request arriving with a different or absent fingerprint is
// refused exactly as before, and reaches no renewal — that remains an ordinary
// ended sign-in, answered by session_expiry.RespondSignInNoLongerValid and never
// by sending the login page back to a request that asked for data.
//
// The device binding's twin is app/backend/pipeline/device_id_check/device_id_check.go.
func WithFingerprintCheck(originalHandler http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		session, err := e_sessions.GetOrCreateSession(w, r)
		if err != nil {
			session_expiry.RespondSignInNoLongerValid(w, r, nil, "fingerprint stage could not read the session")
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
		cookieFingerprint, cookieErr := r.Cookie(e_sessions.FingerprintCookieName())
		if cookieErr != nil || cookieFingerprint.Value == "" {
			if sessFingerprint == "" {
				session_expiry.RespondSignInNoLongerValid(w, r, session, "no fingerprint value in session or cookie")
				return
			}
			// The session carries a fingerprint but the browser's cookie is gone,
			// which is what an expired binding looks like.
			session_expiry.RespondSignInNoLongerValid(w, r, session, "fingerprint cookie missing")
			return
		}

		// Both values are HMAC-signed by the server — a simple equality check is sufficient.
		if sessFingerprint != cookieFingerprint.Value {
			session_expiry.RespondSignInNoLongerValid(w, r, session, "fingerprint cookie does not match the session")
			return
		}

		// The binding has just proved this is the same browser, so it is given
		// the same fresh seven days the session gets whenever a request writes
		// it. The server re-issues its own stored value, never the request's, so
		// an active person's binding cannot expire under a session that is still
		// being extended.
		e_sessions.SetFingerprintCookie(w, sessFingerprint)

		// OK -> jatketaan
		originalHandler(w, r)
	}
}
