// device_id_check.go
// Pipeline stage that validates the device ID submitted with each request.
// Bridges the request device cookie and the session-stored device identifier.
// Exists to detect session hijacking by ensuring device IDs match the session.
package device_id_check

import (
	"net/http"

	"easelect/backend/core_components/session_expiry"
	e_sessions "easelect/backend/core_components/sessions"
)

// WithDeviceIDCheck validates the request device cookie against the session value.
// It sits between authenticated pipeline routes and downstream handlers, letting
// guest requests pass while treating a logged-in session with a missing or
// mismatched device identifier as a sign-in the server can no longer accept.
//
// Like the fingerprint binding, the device cookie used to be written only at
// sign-in while the session's seven days restarted every time a request wrote
// the session, so a person who kept using the site was eventually signed out by
// a binding that had expired underneath a still-readable session. This stage now
// renews the binding on the session's own terms: a request that proves the
// binding is still the right one re-issues it for a full seven days, using the
// value the session itself holds and only after the comparison has succeeded. A
// request with a different or absent device identifier is refused exactly as
// before and reaches no renewal, and a genuinely long-absent person still
// returns with a readable session and no binding.
// session_expiry.RespondSignInNoLongerValid owns that answer for the whole
// application.
//
// The fingerprint binding's twin is
// app/backend/pipeline/fingerprint_check/fingerprint_check.go.
func WithDeviceIDCheck(originalHandler http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		session, err := e_sessions.GetOrCreateSession(w, r)
		if err != nil {
			session_expiry.RespondSignInNoLongerValid(w, r, nil, "device stage could not read the session")
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
			session_expiry.RespondSignInNoLongerValid(w, r, session, "no device_id in session")
			return
		}

		// Haetaan device_id-eväste
		cookie_device_id, err := r.Cookie(e_sessions.DeviceIDCookieName())
		if err != nil || cookie_device_id.Value == "" {
			session_expiry.RespondSignInNoLongerValid(w, r, session, "device_id cookie missing")
			return
		}

		if cookie_device_id.Value != sess_device_id {
			session_expiry.RespondSignInNoLongerValid(w, r, session, "device_id cookie does not match the session")
			return
		}

		// The binding has just proved this is the same browser, so it is given
		// the same fresh seven days the session gets whenever a request writes
		// it. The server re-issues its own stored value, never the request's, so
		// an active person's binding cannot expire under a session that is still
		// being extended.
		e_sessions.SetDeviceIDCookie(w, sess_device_id)

		// OK -> jatketaan varsinaiseen handleriin
		originalHandler(w, r)
	}
}
