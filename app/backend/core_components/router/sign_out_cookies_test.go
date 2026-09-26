// sign_out_cookies_test.go
// Verifies that signing out ends all three cookies that carry a sign-in at once.
// Between the sign-out handler and the browser that held the session and its two bindings.
// Exists because the three cookies are renewed together on every use, so the one
// thing that must still end them all together is an explicit sign-out. Lives beside
// the root page's tests for their mocked configuration read, which the sign-out
// handler needs in order to choose where to send the person afterwards.
package router

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"easelect/backend/core_components/auth"
	e_sessions "easelect/backend/core_components/sessions"
)

func TestSigningOutEndsAllThreeSignInCookies(t *testing.T) {
	for _, site := range rootPageSiteKinds {
		t.Run(site.name, func(t *testing.T) {
			setupRootHandlerMockDB(t, site.loginToBrowse)
			setupRootHandlerSessionStore(t)

			browser := buildRootHandlerBrowserSession(t, 42, "the-signed-in-device", "the-signed-in-fingerprint")
			request := rootPageNavigation("/api/logout", browser.sessionCookie, browser.deviceCookie, browser.fingerprintCookie)
			recorder := httptest.NewRecorder()

			auth.LogoutHandler(recorder, request)

			if recorder.Code != http.StatusSeeOther {
				t.Fatalf("status = %d, want %d", recorder.Code, http.StatusSeeOther)
			}
			ended := map[string]bool{}
			for _, cookie := range recorder.Result().Cookies() {
				if cookie.MaxAge >= 0 && cookie.Value != "" {
					t.Fatalf("sign-out re-issued %q = %q for %d seconds instead of ending it", cookie.Name, cookie.Value, cookie.MaxAge)
				}
				ended[cookie.Name] = true
			}
			for _, name := range []string{
				e_sessions.SessionName,
				e_sessions.DeviceIDCookieName(),
				e_sessions.FingerprintCookieName(),
			} {
				if !ended[name] {
					t.Fatalf("sign-out left %q with the browser", name)
				}
			}
		})
	}
}
