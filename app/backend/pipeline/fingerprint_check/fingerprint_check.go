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
// This stage compares and never writes. A sign-in is carried by three cookies
// that must run out together — the session and its two bindings — and they are
// renewed in one place, e_sessions.RenewUsedSignIn, once a request has proved
// both bindings. The device stage, which the pipeline runs right after this one
// (app/backend/pipeline/pipeline_order.go), makes that call; a renewal here as
// well would write the same cookies twice on every protected request, and a
// renewal here alone would hand a fingerprint back before the device binding
// had been compared at all.
//
// A request arriving with a different or absent fingerprint is refused here and
// reaches no renewal — that remains an ordinary ended sign-in, answered by
// session_expiry.RespondSignInNoLongerValid and never by sending the login page
// back to a request that asked for data.
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

		// OK -> jatketaan. The renewal of all three sign-in cookies happens in
		// the device stage, once it has compared the second binding too.
		originalHandler(w, r)
	}
}
