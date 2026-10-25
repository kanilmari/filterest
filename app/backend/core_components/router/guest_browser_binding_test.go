// guest_browser_binding_test.go
// Checks the root and storage guest paths without a database or browser.
// Confirms old security bindings disappear while functional session state survives.
package router

import (
	"net/http"
	"net/http/httptest"
	"testing"

	e_sessions "easelect/backend/core_components/sessions"
	"github.com/gorilla/sessions"
)

func TestPassiveGuestWritersClearBindingsAndKeepFunctionalSession(t *testing.T) {
	setupRootHandlerSessionStore(t)
	for _, writer := range []struct {
		name   string
		ensure func(http.ResponseWriter, *http.Request, *sessions.Session)
	}{
		{"root", clearGuestBrowserBinding},
		{"storage", ensureStorageGuestSession},
	} {
		t.Run(writer.name, func(t *testing.T) {
			for _, userID := range []int{0, -1, 1, 42} {
				for _, stale := range []bool{false, true} {
					r := httptest.NewRequest(http.MethodGet, "/storage/media/proof.png", nil)
					session, err := e_sessions.Load(r)
					if err != nil {
						t.Fatal(err)
					}
					if userID != 0 {
						session.Values["user_id"] = userID
					}
					session.Values["csrf_token"] = "functional-csrf"
					session.Values["lang"] = "fi"
					session.Values["otp_pending_fingerprint"] = "explicit-login-state"
					if stale {
						session.Values["device_id"] = "old-device"
						session.Values["fingerprint_hash"] = "old-fingerprint"
					}
					r.AddCookie(&http.Cookie{Name: e_sessions.DeviceIDCookieName(), Value: "old-device"})
					r.AddCookie(&http.Cookie{Name: e_sessions.FingerprintCookieName(), Value: "old-fingerprint"})
					w := httptest.NewRecorder()
					writer.ensure(w, r, session)
					if userID > 1 {
						if len(w.Result().Cookies()) != 0 {
							t.Fatal("signed-in writer changed cookies")
						}
						if stale && (session.Values["device_id"] != "old-device" || session.Values["fingerprint_hash"] != "old-fingerprint") {
							t.Fatal("signed-in binding changed")
						}
						continue
					}
					for _, name := range []string{e_sessions.DeviceIDCookieName(), e_sessions.FingerprintCookieName()} {
						cookie := responseCookie(w, name)
						if cookie == nil || cookie.Value != "" || cookie.MaxAge != -1 || cookie.Path != "/" || !cookie.HttpOnly {
							t.Fatalf("old cookie not expired: %+v", cookie)
						}
					}
					for _, key := range []string{"device_id", "fingerprint_hash"} {
						if _, exists := session.Values[key]; exists {
							t.Fatalf("guest kept %s", key)
						}
					}
					// Exercise the shared generic save after cleanup, not just the map.
					persisted := httptest.NewRecorder()
					if err := e_sessions.Save(persisted, r, session); err != nil {
						t.Fatal(err)
					}
					next := rootPageNavigation("/", responseCookie(persisted, e_sessions.SessionName))
					cleaned, err := e_sessions.Load(next)
					if err != nil {
						t.Fatal(err)
					}
					if cleaned.Values["csrf_token"] != "functional-csrf" || cleaned.Values["lang"] != "fi" || cleaned.Values["otp_pending_fingerprint"] != "explicit-login-state" {
						t.Fatal("functional session or pending sign-in state lost")
					}
					for _, key := range []string{"device_id", "fingerprint_hash"} {
						if _, exists := cleaned.Values[key]; exists {
							t.Fatalf("generic save restored %s", key)
						}
					}
				}
			}
		})
	}
}
