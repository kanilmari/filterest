// guest_browser_binding.go
// Removes obsolete guest browser bindings while preserving the functional session.
// Shared by the root page, access control and storage's passive guest paths.
// Guests have no authenticated session to protect; explicit sign-in owns enrollment.
package e_sessions

import (
	"net/http"
	"time"

	"github.com/gorilla/sessions"
)

// ClearGuestBrowserBindings expires both instance-owned security cookies and
// removes their session entries so a later generic Save cannot carry them on.
// It reports whether the caller needs to save the changed session. The session
// cookie itself, CSRF, language and pending sign-in state are left in place.
func ClearGuestBrowserBindings(w http.ResponseWriter, session *sessions.Session) bool {
	if userID, _ := session.Values["user_id"].(int); userID > 1 {
		return false
	}
	changed := false
	for _, key := range []string{"device_id", "fingerprint_hash"} {
		if _, exists := session.Values[key]; exists {
			delete(session.Values, key)
			changed = true
		}
	}
	for _, name := range []string{DeviceIDCookieName(), FingerprintCookieName()} {
		http.SetCookie(w, &http.Cookie{
			Name: name, Value: "", Path: "/", Expires: time.Unix(0, 0), MaxAge: -1,
			HttpOnly: true, Secure: ShouldUseSecureCookies(), SameSite: http.SameSiteLaxMode,
		})
	}
	return changed
}
