// root_browser_binding.go
// Removes obsolete browser bindings from guests visiting the public root page.
// Between the public root page and the device and fingerprint pipeline stages.
// Exists because the root page runs neither of those stages, so a request that
// owns nothing but a stolen session cookie must not be able to ask this page for
// the very values that later prove it is the browser which signed in. A visitor
// who did sign in is compared with, and renewed by, e_sessions.RenewUsedSignIn —
// the same call the device stage makes — so this file owns only the guest side.
package router

import (
	"net/http"

	e_sessions "easelect/backend/core_components/sessions"

	"github.com/gorilla/sessions"
)

// The device and fingerprint stages protect authenticated sessions. Guest
// cleanup is shared with access control and storage in the sessions package.

// isSignedInUserID reports whether a session identity belongs to a person who
// signed in, rather than to the shared guest identity (1) or to no identity at
// all. It is the mirror image of isGuestUserID and draws the line at the same
// place the device and fingerprint stages draw it.
func isSignedInUserID(userIDVal interface{}) bool {
	userID, ok := userIDVal.(int)
	return ok && userID > 1
}

// clearGuestBrowserBinding retires old guest bindings and keeps the functional
// session used by CSRF, language and the sign-in flow. Signed-in bindings are
// exclusively created by authentication and renewed by RenewUsedSignIn.
func clearGuestBrowserBinding(w http.ResponseWriter, r *http.Request, session *sessions.Session) {
	if isSignedInUserID(session.Values["user_id"]) {
		return
	}
	changed := e_sessions.ClearGuestBrowserBindings(w, session)
	if changed || session.IsNew {
		_ = e_sessions.Save(w, r, session)
	}
}
