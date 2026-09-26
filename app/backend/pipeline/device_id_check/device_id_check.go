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
// This stage is where a sign-in counts as used. The pipeline runs it right
// after the fingerprint stage (app/backend/pipeline/pipeline_order.go), so a
// request that passes its comparison has proved both bindings, and that is the
// moment all three cookies carrying the sign-in — the session, the device
// binding and the fingerprint binding — are renewed together for one fresh
// lifetime, through e_sessions.RenewUsedSignIn. They used to renew on different
// rhythms: the bindings on every protected request, the session only when a
// handler happened to write it, so a person who used the site daily without a
// full page load could be signed out on the day the session lapsed.
//
// A request with a different or absent device identifier is refused before that
// line and reaches no renewal, and a genuinely long-absent person still returns
// with a readable session and no binding. session_expiry.RespondSignInNoLongerValid
// owns that answer for the whole application.
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

		// Both bindings have now been compared and found equal, so the sign-in
		// has been used: all three of its cookies get the same fresh lifetime,
		// from the session's own stored values, never the request's. The renewal
		// re-checks both bindings itself, so a route that ran this stage alone
		// could still not be handed a fingerprint it never presented.
		e_sessions.RenewUsedSignIn(w, r, session)

		// OK -> jatketaan varsinaiseen handleriin
		originalHandler(w, r)
	}
}
